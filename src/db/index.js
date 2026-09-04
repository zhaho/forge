const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../data'));
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'forge.sqlite'));
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// If Forge was killed/restarted mid-run, don't leave steps/deployments stuck as 'running' forever.
db.prepare("UPDATE steps SET status = 'interrupted', finished_at = datetime('now') WHERE status = 'running'").run();
db.prepare("UPDATE deployments SET status = 'failed', updated_at = datetime('now') WHERE status = 'running'").run();

module.exports = db;
