const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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
db.prepare("UPDATE deployments SET status = 'failed', updated_at = datetime('now') WHERE status = 'running'").run();

module.exports = db;
