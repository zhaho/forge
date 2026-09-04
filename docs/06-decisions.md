# Decisions log

Decisions confirmed during planning (2026-09-03), and open questions still
to be answered before/while building later phases.

## Confirmed decisions

| Area | Decision |
|---|---|
| Frontend | Server-rendered EJS (no SPA build step); Tailwind CSS + daisyUI for styling, compiled to a static CSS file at Docker build time (superseded Pico.css, 2026-09-04) |
| Live updates | Server-Sent Events (SSE) |
| Terraform workdir | Forge owns its own working directory per deployment (not `terraform-deployment/environments`) |
| Terraform module source | Vendor/copy `proxmox-vm` module into the `forge` repo |
| Ansible model | Switch from `ansible-pull` (triggered inside the VM by a TF provisioner) to Forge-driven `ansible-playbook` push |
| Roles/playbooks | In scope — Forge plan includes designing the actual playbooks per role |
| Multi-node sub-roles | Auto-assign by position (node 1 = control-plane, rest = workers) — no manual per-node picker in v1 |
| Auth | Single admin account only for v1, created via first-run Register page |
| Repo location | Forge app code + all planning docs live in the `forge` repo |
| Concurrency | Multiple deployments can run in parallel; steps within one deployment are sequential |
| Network | LAN-only, plain HTTP (no HTTPS/reverse proxy needed for v1) |
| SSH to new VMs | Reuse existing `~/.ssh/id_rsa` + `zhaho` user already trusted via the template/cloud-init |
| `ansible-proxmox-deploy` | Still actively used for building the base template (`build_image` role) — not legacy |
| VM template management | In scope, but as a later phase (Phase 7), not v1 |
| v1 role catalog | `lab`, `mgmt`, `k3s-cluster` |
| Packaging | Docker + docker-compose, included in v1 (not deferred) — makes Forge easy to redeploy elsewhere later |
| Container networking | Bridge network + mapped port for the GUI (no host networking / no Docker socket needed) |
| Docker availability | Already installed on the target ansible server |
| Role system | Roles are component-based and GUI-editable: a role = a checked set of reusable Ansible-role "components" (e.g. oh-my-zsh, btop, telegraf), editable/creatable from a `/roles` admin page — not a fixed static playbook per role |
| k3s-cluster | Stays a dedicated hardcoded playbook (control-plane/worker join logic) rather than component-based, since it doesn't fit the flat checklist model |
| k3s install method | Plain official install script (`curl -sfL https://get.k3s.io \| sh -`), latest stable, no version pin |
| SSH host key checking | `accept-new` for both raw SSH (cloud-init wait) and Ansible (`host_key_checking = False` + `StrictHostKeyChecking=accept-new` in ssh args, known_hosts file kept on the persistent data volume) |
| `lab` / `mgmt` playbook content | Start with just the `oh-my-zsh` component; expand later via the Roles GUI as new components are added |

## Superseded

- Static one-playbook-per-role design in the original
  [roles doc](./04-roles-and-playbooks.md) is replaced by the component-based
  system above (2026-09-04).

## Open questions (need answers before/while implementing)

These didn't block the plan itself but will need answers before the
relevant phase starts:

1. **Job queue concurrency limit** — how many deployments in parallel is
   reasonable given your Proxmox host's actual capacity? (a number, or
   "unlimited") — currently defaults to 3, tunable via
   `MAX_CONCURRENT_DEPLOYMENTS`.
2. **Terraform plan step** — should the pipeline show a `terraform_plan`
   step for review before apply, or go straight to apply (current
   scripted flow auto-approves)? — currently goes straight to apply.
3. **Log retention** — keep logs forever, or prune after N days /
   N deployments?
4. **phpIPAM race conditions** — mitigated: Forge now reserves each IP in
   phpIPAM immediately after picking it (with a retry loop), instead of
   just asking `first_free` for every node up front. A true race between
   two *simultaneous* deployments is still technically possible but far
   less likely.
5. **Module sync strategy** — how should the vendored copy of
   `proxmox-vm` in `forge` stay in sync if it's updated in
   `terraform-deployment`? (manual copy, a small sync script, or a git
   subtree/submodule)
6. **Proxmox node selection** — v1 assumes a single `target_node`
   (`proxmox`); do you have more than one Proxmox node/cluster member to
   pick from in the deployment form?
