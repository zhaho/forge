const db = require('./index');

const STEP_NAMES = ['allocate_ips', 'generate_terraform', 'terraform_init', 'terraform_apply'];

function listRoles() {
  return db.prepare('SELECT * FROM roles ORDER BY id').all();
}

function getRoleByKey(key) {
  return db.prepare('SELECT * FROM roles WHERE key = ?').get(key);
}

function getRoleById(id) {
  return db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
}

function createDeployment({ name, roleId, quantity, targetNode }) {
  const info = db
    .prepare('INSERT INTO deployments (name, role_id, quantity, target_node) VALUES (?, ?, ?, ?)')
    .run(name, roleId, quantity, targetNode);
  return info.lastInsertRowid;
}

function setWorkdir(id, workdirPath) {
  db.prepare('UPDATE deployments SET workdir_path = ? WHERE id = ?').run(workdirPath, id);
}

function addNode(deploymentId, name, subnetId) {
  db.prepare('INSERT INTO deployment_nodes (deployment_id, name, subnet_id) VALUES (?, ?, ?)').run(
    deploymentId,
    name,
    subnetId,
  );
}

function createSteps(deploymentId) {
  const insert = db.prepare('INSERT INTO steps (deployment_id, seq, name) VALUES (?, ?, ?)');
  STEP_NAMES.forEach((stepName, idx) => insert.run(deploymentId, idx + 1, stepName));
}

const DESTROY_STEP_NAMES = ['terraform_destroy', 'mark_destroyed'];

function markDestroyRequested(id) {
  db.prepare(
    "UPDATE deployments SET action = 'destroy', status = 'queued', updated_at = datetime('now') WHERE id = ?",
  ).run(id);
}

function createDestroySteps(deploymentId) {
  const existing = getSteps(deploymentId);
  const nextSeq = existing.length ? Math.max(...existing.map((s) => s.seq)) + 1 : 1;
  const insert = db.prepare('INSERT INTO steps (deployment_id, seq, name) VALUES (?, ?, ?)');
  DESTROY_STEP_NAMES.forEach((stepName, idx) => insert.run(deploymentId, nextSeq + idx, stepName));
}

function getDeployment(id) {
  return db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
}

function listDeployments() {
  return db
    .prepare(
      `SELECT d.*, r.label AS role_label
       FROM deployments d
       JOIN roles r ON r.id = d.role_id
       ORDER BY d.created_at DESC`,
    )
    .all();
}

function getNodes(deploymentId) {
  return db.prepare('SELECT * FROM deployment_nodes WHERE deployment_id = ? ORDER BY id').all(deploymentId);
}

function getSteps(deploymentId) {
  return db.prepare('SELECT * FROM steps WHERE deployment_id = ? ORDER BY seq').all(deploymentId);
}

function updateDeploymentStatus(id, status) {
  db.prepare("UPDATE deployments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

function buildUpdate(table, id, fields) {
  const sets = Object.keys(fields).map((key) => `${key} = ?`);
  const values = Object.values(fields);
  values.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function updateStep(id, fields) {
  buildUpdate('steps', id, fields);
}

function updateNode(id, fields) {
  buildUpdate('deployment_nodes', id, fields);
}

module.exports = {
  STEP_NAMES,
  listRoles,
  getRoleByKey,
  getRoleById,
  createDeployment,
  setWorkdir,
  addNode,
  createSteps,
  markDestroyRequested,
  createDestroySteps,
  getDeployment,
  listDeployments,
  getNodes,
  getSteps,
  updateDeploymentStatus,
  updateStep,
  updateNode,
};
