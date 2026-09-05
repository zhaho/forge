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
  started_at   TEXT,
  finished_at  TEXT,
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
  params        TEXT,
  UNIQUE(deployment_id, seq)
);

-- A component is a single reusable Ansible role (e.g. oh-my-zsh, btop, telegraf).
CREATE TABLE IF NOT EXISTS components (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  description  TEXT,
  ansible_role TEXT NOT NULL
);

-- A role (lab, mgmt, custom...) is composed of a checked set of components.
-- Roles with a non-empty playbook_path (e.g. k3s-cluster) use a dedicated
-- playbook instead and are not component-based.
CREATE TABLE IF NOT EXISTS role_components (
  role_id      INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, component_id)
);

-- Which components are actually installed on a given deployment right now.
-- Seeded from the role's components at deployment creation time, then
-- diverges independently as components are installed/removed per-deployment.
CREATE TABLE IF NOT EXISTS deployment_components (
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  component_id  INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (deployment_id, component_id)
);

INSERT OR IGNORE INTO roles (key, label, playbook_path, supports_sub_roles) VALUES
  ('lab', 'Lab server', '', 0),
  ('mgmt', 'Management', '', 0),
  ('k3s-cluster', 'K3s cluster', 'k3s-cluster.yml', 1);

-- Migrate roles created before the component-based role builder existed:
-- lab/mgmt used to point at static playbooks that were never actually written.
UPDATE roles SET playbook_path = '' WHERE key IN ('lab', 'mgmt') AND playbook_path != '';
UPDATE roles SET playbook_path = 'k3s-cluster.yml' WHERE key = 'k3s-cluster' AND playbook_path != 'k3s-cluster.yml';

INSERT OR IGNORE INTO components (key, label, description, ansible_role) VALUES
  ('oh-my-zsh', 'Oh My Zsh', 'Installs zsh + Oh My Zsh for the deploy user.', 'oh-my-zsh'),
  ('btop', 'btop', 'Installs the btop system monitor.', 'btop'),
  ('telegraf', 'Telegraf', 'Installs and starts the Telegraf metrics agent.', 'telegraf'),
  ('docker', 'Docker', 'Installs Docker Engine, CLI and the Docker Compose plugin.', 'docker');

INSERT OR IGNORE INTO role_components (role_id, component_id)
  SELECT r.id, c.id FROM roles r, components c WHERE r.key IN ('lab', 'mgmt') AND c.key = 'oh-my-zsh';
