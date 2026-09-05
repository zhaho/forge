const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../data'));
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'forge.sqlite'));
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Idempotent migration: older DBs predate the per-step params column (used
// to target a single component for a re-run instead of the whole role).
try {
  db.exec('ALTER TABLE steps ADD COLUMN params TEXT');
} catch (err) {
  // Column already exists - fine.
}

// Idempotent migration: older DBs predate deployment-level timing columns.
try {
  db.exec('ALTER TABLE deployments ADD COLUMN started_at TEXT');
} catch (err) {
  // Column already exists - fine.
}
try {
  db.exec('ALTER TABLE deployments ADD COLUMN finished_at TEXT');
} catch (err) {
  // Column already exists - fine.
}

// Idempotent migration: older DBs predate per-deployment image selection.
try {
  db.exec('ALTER TABLE roles ADD COLUMN default_image_id INTEGER REFERENCES images(id)');
} catch (err) {
  // Column already exists - fine.
}
try {
  db.exec('ALTER TABLE deployments ADD COLUMN image_id INTEGER REFERENCES images(id)');
} catch (err) {
  // Column already exists - fine.
}
try {
  db.exec('ALTER TABLE deployments ADD COLUMN template_id INTEGER');
} catch (err) {
  // Column already exists - fine.
}
// Deployments created before per-deployment images existed all cloned the
// single template configured via PROXMOX_TEMPLATE_ID - backfill that as their
// effective template_id so a future retry still renders valid Terraform.
db.prepare('UPDATE deployments SET template_id = ? WHERE template_id IS NULL').run(config.proxmox.templateId);

// Backfill deployment-level timing for deployments that predate the started_at/
// finished_at columns, using their steps' own timestamps as the source of truth.
try {
  const TERMINAL_DEPLOYMENT_STATUSES = ['success', 'failed', 'destroyed'];
  const needsBackfill = db.prepare('SELECT id, status FROM deployments WHERE started_at IS NULL').all();
  const getStepBounds = db.prepare(
    'SELECT MIN(started_at) AS first, MAX(finished_at) AS last FROM steps WHERE deployment_id = ? AND started_at IS NOT NULL',
  );
  const setTimes = db.prepare('UPDATE deployments SET started_at = ?, finished_at = ? WHERE id = ?');
  needsBackfill.forEach((deployment) => {
    const bounds = getStepBounds.get(deployment.id);
    if (!bounds.first) return;
    const finishedAt = TERMINAL_DEPLOYMENT_STATUSES.includes(deployment.status) ? bounds.last : null;
    setTimes.run(bounds.first, finishedAt, deployment.id);
  });
} catch (err) {
  // Best-effort backfill - safe to skip if anything is unexpected here.
}

// Backfill deployment_components for deployments created before per-deployment
// component tracking existed, using the role's component list as a best guess.
try {
  const deploymentsNeedingSeed = db
    .prepare(
      `SELECT d.id, d.role_id FROM deployments d
       JOIN roles r ON r.id = d.role_id
       WHERE r.playbook_path = ''
         AND NOT EXISTS (SELECT 1 FROM deployment_components dc WHERE dc.deployment_id = d.id)`,
    )
    .all();
  const insertDeploymentComponent = db.prepare(
    'INSERT OR IGNORE INTO deployment_components (deployment_id, component_id) VALUES (?, ?)',
  );
  const getRoleComponentIds = db.prepare(
    'SELECT c.id FROM components c JOIN role_components rc ON rc.component_id = c.id WHERE rc.role_id = ?',
  );
  deploymentsNeedingSeed.forEach((deployment) => {
    getRoleComponentIds.all(deployment.role_id).forEach((component) => {
      insertDeploymentComponent.run(deployment.id, component.id);
    });
  });
} catch (err) {
  // Best-effort backfill - safe to skip if anything is unexpected here.
}

// If Forge was killed/restarted mid-run, don't leave steps/deployments stuck as 'running' forever.
db.prepare("UPDATE steps SET status = 'interrupted', finished_at = datetime('now') WHERE status = 'running'").run();
db.prepare(
  "UPDATE deployments SET status = 'failed', finished_at = datetime('now'), updated_at = datetime('now') WHERE status = 'running'",
).run();
db.prepare("UPDATE image_steps SET status = 'interrupted', finished_at = datetime('now') WHERE status = 'running'").run();
db.prepare(
  "UPDATE images SET status = 'failed', finished_at = datetime('now'), updated_at = datetime('now') WHERE status = 'running'",
).run();

module.exports = db;
