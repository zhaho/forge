# Forge — Overview

Forge is a self-hosted web GUI for deploying, tracking, and destroying VMs on
Proxmox for a home lab network. It wraps the existing Terraform + Ansible +
phpIPAM workflow (currently run by hand from `terraform-deployment` /
`ansible-deployment`) in a single dashboard with live logs, step-by-step
re-run, and a dark-mode UI.

## Goals (v1)

- Web GUI, dark mode by default.
- First-run "Register" page creates the single admin account; after that,
  login is the only way in (no open registration).
- Form to request a deployment: name/prefix, role (dropdown: `lab`, `mgmt`,
  `k3s-cluster`), quantity.
  - Quantity > 1 with a simple role (`lab`, `mgmt`) → nodes named
    `<name>01`, `<name>02`, ... all get the same role.
  - `k3s-cluster` with quantity 3 → node 1 becomes control-plane, the rest
    become workers, automatically.
- Deployment is broken into discrete, resumable **steps** (IP allocation,
  Terraform init/apply, cloud-init wait, Ansible run, verify). Any step can
  be re-run individually without redoing the whole deployment.
- Live status + live log streaming in the GUI (Server-Sent Events) — no
  need to SSH into the ansible server to watch progress.
- Logs are persisted to disk on the same host Forge runs on (the ansible
  server), viewable/downloadable later from the GUI.
- Destroy a deployment (terraform destroy + IPAM de-registration) from the
  GUI, with confirmation.
- Multiple deployments can run in parallel; steps *within* one deployment
  run sequentially.

## Non-goals / later phases

- Multi-user / RBAC (single admin account is enough for v1).
- Building/maintaining the base Proxmox VM template — in scope for a
  **later** phase (see [roadmap](./05-roadmap.md)), not v1.
- HTTPS/reverse proxy — LAN-only HTTP is fine for now.

## Where things live

- **This repo (`forge`)** — the Node.js/SQLite application itself, plus all
  planning docs (this folder).
- **`terraform-deployment`** — source of the reusable `proxmox-vm` module
  and the existing `ipam-config.tf` conventions. Forge vendors its own copy
  of the module (see [architecture](./01-architecture.md#terraform-execution))
  rather than depending on that repo at runtime.
- **`ansible-deployment`** — today only has an `oh-my-zsh` role. Forge's
  scope includes designing/adding the real per-role playbooks
  (`lab`, `mgmt`, `k3s-cluster`) — see [roles](./04-roles-and-playbooks.md).
- **`ansible-proxmox-deploy`** — still used to build the base Proxmox
  template (`build_image` role). Out of scope for v1, planned as a later
  phase.

## Docs in this folder

| Doc | Contents |
|---|---|
| [01-architecture.md](./01-architecture.md) | Stack, components, execution model |
| [02-data-model.md](./02-data-model.md) | SQLite schema |
| [03-deployment-pipeline.md](./03-deployment-pipeline.md) | Step state machine, retry semantics |
| [04-roles-and-playbooks.md](./04-roles-and-playbooks.md) | Role catalog, k3s sub-role logic |
| [05-roadmap.md](./05-roadmap.md) | Phased delivery plan |
| [06-decisions.md](./06-decisions.md) | Decision log (ADR-style) + open questions |
