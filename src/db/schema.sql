CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  key                TEXT NOT NULL UNIQUE,
  label              TEXT NOT NULL,
  playbook_path      TEXT NOT NULL,
  supports_sub_roles INTEGER NOT NULL DEFAULT 0,
  default_cores      INTEGER NOT NULL DEFAULT 2,
  default_memory     INTEGER NOT NULL DEFAULT 4096,
  default_disk_size  INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS deployments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  role_id      INTEGER NOT NULL REFERENCES roles(id),
  quantity     INTEGER NOT NULL DEFAULT 1,
  target_node  TEXT NOT NULL,
  action       TEXT NOT NULL DEFAULT 'create',
  status       TEXT NOT NULL DEFAULT 'queued',
  workdir_path TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deployment_nodes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  sub_role      TEXT,
  ip            TEXT,
  subnet_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  log_path      TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  UNIQUE(deployment_id, seq)
);

INSERT OR IGNORE INTO roles (key, label, playbook_path, supports_sub_roles) VALUES
  ('lab', 'Lab server', 'playbooks/lab.yml', 0),
  ('mgmt', 'Management', 'playbooks/mgmt.yml', 0),
  ('k3s-cluster', 'K3s cluster', 'playbooks/k3s-cluster.yml', 1);
