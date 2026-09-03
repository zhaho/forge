# Decisions log

Decisions confirmed during planning (2026-09-03), and open questions still
to be answered before/while building later phases.

## Confirmed decisions

| Area | Decision |
|---|---|
| Frontend | Server-rendered EJS + HTMX (no SPA build step) |
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

## Open questions (need answers before/while implementing)

These didn't block the plan itself but will need answers before the
relevant phase starts:

1. **`lab.yml` / `mgmt.yml` content** — beyond oh-my-zsh, what should the
   `lab` and `mgmt` playbooks actually configure? (packages, monitoring
   agent, users, etc.)
2. **k3s version/install method** — plain `get.k3s.io` install script, a
   specific k3s version pin, or an existing Ansible k3s role/collection?
3. **Job queue concurrency limit** — how many deployments in parallel is
   reasonable given your Proxmox host's actual capacity? (a number, or
   "unlimited")
4. **Terraform plan step** — should the pipeline show a `terraform_plan`
   step for review before apply, or go straight to apply (current
   scripted flow auto-approves)?
5. **Log retention** — keep logs forever, or prune after N days /
   N deployments?
6. **phpIPAM race conditions** — `create-environment.sh` picks a free IP
   at generation time; if two deployments are created back-to-back before
   Terraform actually registers the IP, they could pick the same free IP.
   Do we need an explicit "reserve" step in phpIPAM, or is this an
   acceptable home-lab risk to defer?
7. **Module sync strategy** — how should the vendored copy of
   `proxmox-vm` in `forge` stay in sync if it's updated in
   `terraform-deployment`? (manual copy, a small sync script, or a git
   subtree/submodule)
8. **Proxmox node selection** — v1 assumes a single `target_node`
   (`proxmox`); do you have more than one Proxmox node/cluster member to
   pick from in the deployment form?
