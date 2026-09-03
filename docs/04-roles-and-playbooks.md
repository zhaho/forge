# Roles & playbooks

## v1 role catalog

| Role key | Label (dropdown) | Sub-roles? | Playbook (in `ansible-deployment`) |
|---|---|---|---|
| `lab` | Lab server | No | `playbooks/lab.yml` |
| `mgmt` | Management | No | `playbooks/mgmt.yml` |
| `k3s-cluster` | K3s cluster | Yes (`control-plane` / `worker`) | `playbooks/k3s-cluster.yml` |

This list is seeded into the `roles` table on first boot. Adding a new role
later = one new row + one new playbook, no code change required (the
dropdown reads from the `roles` table).

## Playbook design

Currently `ansible-deployment` only has `zsh.yml` (oh-my-zsh role). As part
of Forge, we design one playbook per role:

- **`lab.yml`** — baseline lab server config: the existing `oh-my-zsh` role
  + whatever else a generic lab box needs (updates, common packages,
  monitoring agent, etc. — TBD, see [open questions](./06-decisions.md)).
- **`mgmt.yml`** — management-node specific config (TBD which tools).
- **`k3s-cluster.yml`** — a single playbook with host-group-based logic:
  - `[k3s_control_plane]` group → installs k3s server (`curl -sfL
    https://get.k3s.io | sh -`).
  - `[k3s_workers]` group → joins the cluster using the control-plane's
    node token (fetched via Ansible fact/`fetch` from the control-plane
    host, or a small `delegate_to` step).
  - Groups come from the inventory Forge generates per deployment (see
    below) — not from static `ansible-deployment` inventory files.

## Inventory generation

For each deployment, Forge generates `inventory.ini` in the deployment's
workdir, e.g. for a 3-node k3s-cluster deployment:

```ini
[k3s_control_plane]
k3s01 ansible_host=10.4.5.40

[k3s_workers]
k3s02 ansible_host=10.4.5.41
k3s03 ansible_host=10.4.5.42

[all:vars]
ansible_user=zhaho
ansible_ssh_private_key_file=~/.ssh/id_rsa
```

For simple roles (`lab`, `mgmt`) there's a single group named after the
role, containing all requested nodes:

```ini
[lab]
lab01 ansible_host=10.4.5.43
lab02 ansible_host=10.4.5.44
lab03 ansible_host=10.4.5.45
```

## Sub-role assignment (multi-node groups)

Decided: **auto-assign by position** — node 1 (first created) becomes
`control-plane`, all subsequent nodes become `worker`. No manual per-node
picker in v1. If you later want e.g. 3 control-plane + N workers (HA k3s),
that's a future enhancement to the role's assignment rule, not a Forge
architecture change.

## Base VM template (out of scope for v1)

`ansible-proxmox-deploy`'s `build_image` role is still how the base
Proxmox template is built/maintained today. Automating that from Forge
(a "rebuild template" button) is a **later phase** — see
[roadmap](./05-roadmap.md) — v1 assumes the template (`template_id 9200`)
already exists and is current.
