const db = require('./index');

// allocate_vmid: ask Proxmox for a free VMID; build_template: run the Ansible
// build playbook; verify: confirm the resulting VM was converted to a template.
const STEP_NAMES = ['allocate_vmid', 'build_template', 'verify'];
const DESTROY_STEP_NAMES = ['destroy_template'];

function createImage({ name, sourceUrl }) {
  const info = db.prepare('INSERT INTO images (name, source_url) VALUES (?, ?)').run(name, sourceUrl);
  return info.lastInsertRowid;
}

function setWorkdir(id, workdirPath) {
  db.prepare('UPDATE images SET workdir_path = ? WHERE id = ?').run(workdirPath, id);
}

function setVmId(id, vmId) {
  db.prepare('UPDATE images SET vm_id = ? WHERE id = ?').run(vmId, id);
}

function getImage(id) {
  return db.prepare('SELECT * FROM images WHERE id = ?').get(id);
}

function listImages() {
  return db.prepare('SELECT * FROM images ORDER BY created_at DESC').all();
}

// Only successfully-built, still-existing images are valid to clone from.
function listAvailableImages() {
  return db.prepare("SELECT * FROM images WHERE status = 'success' ORDER BY name").all();
}

function createSteps(imageId) {
  const insert = db.prepare('INSERT INTO image_steps (image_id, seq, name) VALUES (?, ?, ?)');
  STEP_NAMES.forEach((stepName, idx) => insert.run(imageId, idx + 1, stepName));
}

// Appends fresh step rows after whatever already exists (used for destroy).
function appendSteps(imageId, stepNames) {
  const existing = getSteps(imageId);
  const nextSeq = existing.length ? Math.max(...existing.map((s) => s.seq)) + 1 : 1;
  const insert = db.prepare('INSERT INTO image_steps (image_id, seq, name) VALUES (?, ?, ?)');
  stepNames.forEach((stepName, idx) => insert.run(imageId, nextSeq + idx, stepName));
}

function createDestroySteps(imageId) {
  appendSteps(imageId, DESTROY_STEP_NAMES);
}

function markDestroyRequested(id) {
  db.prepare("UPDATE images SET action = 'destroy', status = 'queued', updated_at = datetime('now') WHERE id = ?").run(
    id,
  );
}

function getSteps(imageId) {
  return db.prepare('SELECT * FROM image_steps WHERE image_id = ? ORDER BY seq').all(imageId);
}

// Bounds timing to the image's original build steps (seq 1..N) so a later
// destroy - which appends more steps to the same image row - doesn't stretch
// out the reported build duration/finish time.
function getInitialRunTiming(imageId) {
  return db
    .prepare(
      `SELECT MIN(started_at) AS started_at, MAX(finished_at) AS finished_at
       FROM image_steps WHERE image_id = ? AND seq <= ?`,
    )
    .get(imageId, STEP_NAMES.length);
}

const TERMINAL_STATUSES = ['success', 'failed', 'destroyed'];

function updateImageStatus(id, status) {
  if (status === 'running') {
    db.prepare(
      "UPDATE images SET status = ?, started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
    ).run(status, id);
  } else if (TERMINAL_STATUSES.includes(status)) {
    db.prepare(
      "UPDATE images SET status = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ).run(status, id);
  } else {
    db.prepare("UPDATE images SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  }
}

function updateStep(id, fields) {
  const sets = Object.keys(fields).map((key) => `${key} = ?`);
  const values = Object.values(fields);
  values.push(id);
  db.prepare(`UPDATE image_steps SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function resetStepsForRetry(imageId) {
  const toReset = getSteps(imageId).filter((step) => step.status !== 'success');
  const reset = db.prepare(
    "UPDATE image_steps SET status = 'pending', started_at = NULL, finished_at = NULL WHERE id = ?",
  );
  toReset.forEach((step) => reset.run(step.id));
  return toReset;
}

module.exports = {
  STEP_NAMES,
  createImage,
  setWorkdir,
  setVmId,
  getImage,
  listImages,
  listAvailableImages,
  createSteps,
  createDestroySteps,
  markDestroyRequested,
  getSteps,
  getInitialRunTiming,
  updateImageStatus,
  updateStep,
  resetStepsForRetry,
};
