# Vendored copy of terraform-deployment's `modules/proxmox-vm`

This is a manually-synced copy of the reusable Proxmox VM module from the
`terraform-deployment` repo (see [../../docs/06-decisions.md](../../docs/06-decisions.md),
open question #7). Forge's generated deployment workdirs reference this
local copy by absolute path instead of depending on the `terraform-deployment`
repo at runtime.

If the upstream module changes, copy `main.tf` / `variables.tf` / `outputs.tf`
from `terraform-deployment/modules/proxmox-vm` into this folder again.
