# Data model (SQLite)

Minimal v1 schema — single admin user, deployments made up of nodes and
steps.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE roles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  key                   TEXT NOT NULL UNIQUE,   -- 'lab' | 'mgmt' | 'k3s-cluster'
  label                 TEXT NOT NULL,          -- shown in dropdown
  playbook_path         TEXT NOT NULL,          -- e.g. 'playbooks/lab.yml'
  supports_sub_roles    INTEGER NOT NULL DEFAULT 0, -- 1 for k3s-cluster
  default_cores         INTEGER NOT NULL DEFAULT 2,
  default_memory        INTEGER NOT NULL DEFAULT 4096,
  default_disk_size     INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE deployments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,          -- user-supplied prefix, e.g. 'lab'
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  quantity      INTEGER NOT NULL DEFAULT 1,
  target_node   TEXT NOT NULL,          -- proxmox node
  action        TEXT NOT NULL DEFAULT 'create', -- 'create' | 'destroy'
  status        TEXT NOT NULL DEFAULT 'queued', -- queued|running|success|failed|destroyed
  workdir_path  TEXT,                   -- data/workdirs/<id>/
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE deployment_nodes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id  INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,          -- e.g. 'lab01'
  sub_role       TEXT,                  -- e.g. 'control-plane' | 'worker', null for simple roles
  ip             TEXT,                  -- allocated from IPAM, e.g. '10.4.5.42/24'
  subnet_id      TEXT NOT NULL,         -- IPAM subnet id
  status         TEXT NOT NULL DEFAULT 'pending' -- pending|provisioning|ready|failed|destroyed
);

CREATE TABLE steps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id  INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,       -- ordering, 1..N
  name           TEXT NOT NULL,          -- 'allocate_ips' | 'terraform_init' | ...
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|running|success|failed|skipped|interrupted
  log_path       TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  UNIQUE(deployment_id, seq)
);
```

Notes:

- `roles` is a seed table (see [roles doc](./04-roles-and-playbooks.md)) —
  editable later via GUI if needed, hard-coded/seeded for v1.
- `deployment_nodes.ip` is filled in during the `allocate_ips` step (see
  pipeline doc); left `NULL` until then.
- Log **content** stays on disk (`log_path` points at a file); DB only
  tracks metadata — keeps the SQLite file small and avoids write
  contention on large TEXT blobs while a step is actively streaming output.
- No dedicated `sessions` table is listed — `express-session`'s SQLite
  store manages its own table.
