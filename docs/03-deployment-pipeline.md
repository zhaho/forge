# Deployment pipeline (step state machine)

Each deployment (create **or** destroy) is a fixed, ordered list of steps
stored as rows in the `steps` table. Steps run strictly in order for a
given deployment; a failed step stops the pipeline and surfaces an error
in the GUI. Any step can be individually **retried**, which re-runs that
step and all steps after it (previous steps' results — like allocated IPs
or Terraform state — are reused, not redone).

## How a deployment actually runs (services involved)

There is no separate worker process/queue service — the pipeline is a
plain async function (`runDeployment(deploymentId)` in
[src/jobs/pipeline.js](../src/jobs/pipeline.js)) that runs **inside the
same Express/Node process** that serves the GUI. It's invoked directly
from the route handler when a deployment is created or retried
(`src/routes/deployments.js`), not queued to an external broker.

1. **Trigger**: `POST /deployments` (or `/retry`, `/reinstall`, etc.)
   inserts/updates `steps` rows, sets the deployment to `queued`, then
   calls `queue.add(() => pipeline.runDeployment(id))`
   ([src/jobs/queue.js](../src/jobs/queue.js)) — a tiny in-process job
   queue, not an external broker. The HTTP request returns immediately
   (redirect to the deployment's show page).
2. **Queue/concurrency gate**: the queue holds a simple `pending` array
   and an `active` counter capped at `MAX_CONCURRENT_DEPLOYMENTS`
   (default 3). Adding a job runs it immediately if under the cap,
   otherwise it waits until an active job finishes and frees a slot —
   this *is* enforced, not just documentation of intended capacity.
3. **Step dispatch**: once a job is running, `runDeployment` loads all
   `pending` steps for that deployment in `seq` order and, for each one,
   looks up its runner in the `STEP_RUNNERS` map (`allocate_ips` →
   `runAllocateIps`, `terraform_apply` → `runTerraformApply`, etc.) and
   awaits it before moving to the next step — this is what makes steps
   *within* one deployment strictly sequential.
4. **Process execution**: steps that shell out (Terraform, Ansible, SSH)
   go through a shared `runCommand()` helper
   ([src/terraform/executor.js](../src/terraform/executor.js)) that
   wraps Node's `child_process.spawn`. It:
   - runs the command with `cwd` set to the deployment's own
     `data/workdirs/<id>/` directory,
   - merges in step-specific env vars (e.g. `TF_VAR_*` secrets for
     Terraform, `ANSIBLE_CONFIG`/`ANSIBLE_ROLES_PATH` for Ansible),
   - strips ANSI escape codes from stdout/stderr,
   - streams every line to two places simultaneously: appended to the
     step's log file (`data/logs/<id>/<seq>-<name>.log`) and emitted as
     an SSE event so the browser sees it live,
   - rejects the returned promise (throwing) if the process exits
     non-zero, which is what stops the pipeline on failure.
4. **Live updates**: each step emits `{type: 'step', ...}` /
   `{type: 'log', ...}` events through a small per-deployment
   `EventEmitter` ([src/jobs/events.js](../src/jobs/events.js)). The
   `GET /deployments/:id/events` route subscribes the browser to that
   emitter via Server-Sent Events — no polling.
5. **Because it's in-process**: if the Forge container is killed/restarted
   mid-step (e.g. a `docker compose up -d --build`), the `ansible-playbook`
   or `terraform` child process dies with it. On next boot,
   `src/db/index.js` marks any step/deployment that was left `running` as
   `interrupted`/`failed` so it's visibly flagged rather than silently
   stuck, and it can be retried from the GUI.
6. **Concurrency**: the queue lets up to `MAX_CONCURRENT_DEPLOYMENTS`
   deployments' `runDeployment()` calls be in flight at once (each awaits
   its own chain independently on the shared event loop — Node interleaves
   them since the actual work is spawned child processes, not CPU-bound
   work in the Node process itself); any beyond that cap sit in the
   queue's `pending` array until a slot frees up. Steps *within* a single
   deployment are still always sequential (see above).

## Create pipeline

| # | Step | What happens | Idempotent re-run behaviour |
|---|------|--------------|------------------------------|
| 1 | `allocate_ips` | For each node, call phpIPAM `first_free` on the target subnet, record IP in `deployment_nodes` | Skips nodes that already have an IP assigned |
| 2 | `generate_terraform` | Render `main.tf`/`variables.tf`/`provider.tf` into `data/workdirs/<id>/` from templates + node list | Always safe to re-render |
| 3 | `terraform_init` | `terraform init` in the workdir | Safe, no-op if already initialized |
| 4 | `terraform_apply` | `terraform apply -auto-approve`; creates VMs + registers IPs in phpIPAM (module already does this) | Terraform apply is naturally idempotent |
| 5 | `wait_cloud_init` | SSH into each node, run `cloud-init status --wait` | Safe to re-run; just waits again |
| 6 | `ansible_run` | Generate inventory, run `ansible-playbook` for the role (see [roles doc](./04-roles-and-playbooks.md)) | Ansible playbooks are written to be idempotent |
| 7 | `verify` | Basic reachability check (e.g. `ansible all -m ping` against the inventory) | Read-only, always safe |
| 8 | `complete` | Mark deployment `success` | — |

## Destroy pipeline

| # | Step | What happens |
|---|------|--------------|
| 1 | `terraform_destroy` | `terraform destroy -auto-approve` in the existing workdir — also de-registers IPs from phpIPAM (module handles this) |
| 2 | `mark_destroyed` | Mark deployment + nodes `destroyed`; workdir is archived, not deleted (kept for log history) |

## Status values

- Deployment: `queued → running → success | failed`, plus `destroyed`
  after a destroy pipeline completes.
- Step: `pending → running → success | failed`, or `skipped` (not
  currently used in v1, reserved for future conditional steps), or
  `interrupted` (set on Forge startup for any step that was `running` when
  the process last stopped, so it's visibly flagged instead of silently
  stuck).

## Retry semantics

"Retry from step N" (a button per failed/completed step in the GUI):

1. Set steps `>= N` back to `pending` (fresh row state, but keep history —
   v1 simply resets the same row; a future phase could keep an attempt
   history instead of overwriting).
2. Re-enter the queue starting at step N.
3. Because IP allocation, Terraform, and Ansible are all designed to be
   idempotent/resumable, re-running from any step is safe — e.g. retrying
   `terraform_apply` after fixing a Proxmox capacity issue just re-applies
   against existing state; retrying `ansible_run` after fixing a role bug
   just re-converges the same hosts.

## Multi-node groups

- `quantity` on the deployment form controls how many nodes are created:
  node names are `<name>01`, `<name>02`, ... `<name>NN`.
- For roles where `supports_sub_roles = 0` (`lab`, `mgmt`), every node gets
  the same sub-role (`null`) and the same playbook run against all of
  them together in one `ansible_run` step.
- For roles where `supports_sub_roles = 1` (`k3s-cluster`), node 1 is
  auto-assigned `sub_role = control-plane`, nodes 2..N get
  `sub_role = worker` (see [roles doc](./04-roles-and-playbooks.md) for
  how that maps to Ansible groups/inventory).
