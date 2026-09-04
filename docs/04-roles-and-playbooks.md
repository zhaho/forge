# Roles & playbooks

> Updated 2026-09-04: roles are now **component-based and GUI-editable**
> (see below), not one fixed static playbook per role. This supersedes the
> original "one playbook per role" design.

## Role model

- A **component** is one reusable Ansible role living in
  `forge/ansible/roles/<name>/` (e.g. `oh-my-zsh`, `btop`, `telegraf`),
  seeded in the `components` table.
- A **role** (`lab`, `mgmt`, or any custom role created via the GUI) is a
  checked set of components, editable at `/roles` — no code change or
  redeploy needed to add/remove a component from a role.
- When a deployment's `ansible_run` step runs, Forge generates a
  throwaway playbook in the deployment's workdir:
  ```yaml
  - hosts: all
    become: true
    roles:
      - oh-my-zsh
      - btop
  ```
  listing exactly the components currently checked for that role.
- **`k3s-cluster`** is the one exception: it has `supports_sub_roles = 1`
  and a non-empty `playbook_path` (`k3s-cluster.yml`), so Forge uses the
  dedicated playbook in `forge/ansible/playbooks/` instead of the
  component checklist — the control-plane/worker join logic doesn't fit a
  flat per-host role list.
- Seeded v1 catalog: `lab` and `mgmt` both start with just the
  `oh-my-zsh` component checked; `k3s-cluster` as above. Add more
  components (new role directories + a `components` row) and check them
  into a role any time via the GUI.

## k3s-cluster playbook design

`forge/ansible/playbooks/k3s-cluster.yml`:
- `[k3s_control_plane]` group → installs k3s server (`curl -sfL
  https://get.k3s.io | sh -`), reads the generated node token.
- `[k3s_workers]` group → joins the cluster using the control-plane's
  token/IP via Ansible's `hostvars`/`groups` lookups (no manual
  `delegate_to`/`fetch` needed since both plays run in the same
  playbook run).
- Groups come from the inventory Forge generates per deployment (see
  below).

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
ansible_ssh_private_key_file=/home/forge/.ssh/id_rsa
ansible_ssh_common_args='-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/app/data/ssh_known_hosts'
```

For component-based roles (`lab`, `mgmt`, custom roles) there's a single
`[all]` group containing every requested node — the generated playbook
targets `hosts: all`, so no group name matching the role is needed.

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
