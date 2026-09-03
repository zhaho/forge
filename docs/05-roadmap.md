# Roadmap

Phased so each phase leaves you with something usable/testable.

## Phase 0 — Planning (this)

- Architecture, data model, pipeline, and role docs (this folder).
- Decisions log capturing what's confirmed vs. still open.

## Phase 1 — Skeleton & auth

- Express app scaffold, SQLite DB init/migrations.
- Dockerfile + docker-compose.yml (bridge network, mapped port, `data/`
  volume, mounted SSH key, `.env` for secrets) — runs from Docker from
  this phase onward.
- First-run `/register` → creates the single admin user; subsequent
  boots go straight to `/login`.
- Base layout with dark-mode CSS (default and only theme for v1), nav
  shell, empty dashboard page.
- No deployment logic yet — goal is "I can `docker compose up` and log in
  to see an empty dashboard."

## Phase 2 — Single-VM deploy (happy path only)

- Deployment form: name, role dropdown (seeded `lab`/`mgmt`/`k3s-cluster`),
  quantity (default 1).
- `allocate_ips` → `generate_terraform` → `terraform_init` →
  `terraform_apply` steps implemented, run for real against Proxmox.
- Step tracker UI (list of steps + status) and SSE-driven live log tail
  for the currently running step.
- No Ansible yet, no destroy yet, no retry yet — goal is "I can create one
  lab VM from the GUI and watch it happen live."

## Phase 3 — Ansible push + verify

- `wait_cloud_init`, `ansible_run`, `verify` steps.
- Author the three v1 playbooks (`lab.yml`, `mgmt.yml`,
  `k3s-cluster.yml`) in `ansible-deployment`.
- Goal: "A requested VM is fully configured with its role, automatically,
  end to end."

## Phase 4 — Multi-node groups

- Quantity > 1 naming (`name01`, `name02`, ...).
- `k3s-cluster` control-plane/worker auto-assignment + grouped inventory.
- Per-node status display in the GUI (not just deployment-level status).

## Phase 5 — Destroy

- Destroy button per deployment (with confirmation), running the destroy
  pipeline (`terraform_destroy` → `mark_destroyed`).
- Deployment history list (including destroyed ones) with logs still
  viewable/downloadable.

## Phase 6 — Retry & resilience

- Per-step "Retry from here" action.
- Startup recovery: mark steps `interrupted` if Forge restarts mid-run.
- Concurrency: run multiple deployments in parallel (per-deployment
  workdir isolation already supports this from Phase 2 onward — this
  phase is about validating/hardening it, e.g. job queue concurrency
  limits, resource contention on the Proxmox node itself).

## Phase 7 — Stretch goals (not committed yet)

- Base VM template build/rebuild automation (wraps
  `ansible-proxmox-deploy`'s `build_image` role).
- Multi-user / RBAC.
- HTTPS / reverse proxy support.
- Notifications (e.g. on deployment failure).

## Suggested next step

Confirm this plan, then start Phase 1 (app skeleton + auth) as the first
concrete implementation slice.
