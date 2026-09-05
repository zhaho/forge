const db = require('./index');

const STEP_NAMES = [
  'allocate_ips',
  'generate_terraform',
  'terraform_init',
  'terraform_apply',
  'wait_cloud_init',
  'ansible_run',
  'verify',
];

function listRoles() {
  return db.prepare('SELECT * FROM roles ORDER BY id').all();
}

function getRoleByKey(key) {
  return db.prepare('SELECT * FROM roles WHERE key = ?').get(key);
}

function getRoleById(id) {
  return db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
}

function createDeployment({ name, roleId, quantity, targetNode, imageId, templateId }) {
  const info = db
    .prepare('INSERT INTO deployments (name, role_id, quantity, target_node, image_id, template_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, roleId, quantity, targetNode, imageId || null, templateId);
  return info.lastInsertRowid;
}

function setWorkdir(id, workdirPath) {
  db.prepare('UPDATE deployments SET workdir_path = ? WHERE id = ?').run(workdirPath, id);
}

function addNode(deploymentId, name, subnetId, subRole = null) {
  db.prepare('INSERT INTO deployment_nodes (deployment_id, name, subnet_id, sub_role) VALUES (?, ?, ?, ?)').run(
    deploymentId,
    name,
    subnetId,
    subRole,
  );
}

function createSteps(deploymentId) {
  const insert = db.prepare('INSERT INTO steps (deployment_id, seq, name) VALUES (?, ?, ?)');
  STEP_NAMES.forEach((stepName, idx) => insert.run(deploymentId, idx + 1, stepName));
}

// Appends an ansible_run + verify pair. Pass a componentId to target just that
// one component's Ansible role instead of the whole role's component list.
function appendReinstallSteps(deploymentId, componentId) {
  const existing = getSteps(deploymentId);
  const nextSeq = existing.length ? Math.max(...existing.map((s) => s.seq)) + 1 : 1;
  const params = componentId ? JSON.stringify({ componentId }) : null;
  db.prepare('INSERT INTO steps (deployment_id, seq, name, params) VALUES (?, ?, ?, ?)').run(
    deploymentId,
    nextSeq,
    'ansible_run',
    params,
  );
  db.prepare('INSERT INTO steps (deployment_id, seq, name) VALUES (?, ?, ?)').run(deploymentId, nextSeq + 1, 'verify');
}

const DESTROY_STEP_NAMES = ['terraform_destroy', 'mark_destroyed'];

function resetStepsForRetry(deploymentId) {
  const toReset = getSteps(deploymentId).filter((step) => step.status !== 'success');
  const reset = db.prepare(
    "UPDATE steps SET status = 'pending', started_at = NULL, finished_at = NULL WHERE id = ?",
  );
  toReset.forEach((step) => reset.run(step.id));
  return toReset;
}

function markDestroyRequested(id) {
  db.prepare(
    "UPDATE deployments SET action = 'destroy', status = 'queued', updated_at = datetime('now') WHERE id = ?",
  ).run(id);
}

function createDestroySteps(deploymentId) {
  appendSteps(deploymentId, DESTROY_STEP_NAMES);
}

// Appends fresh step rows after whatever already exists (used for destroy and
// for re-running ansible_run/verify on demand, e.g. after editing a role).
function appendSteps(deploymentId, stepNames) {
  const existing = getSteps(deploymentId);
  const nextSeq = existing.length ? Math.max(...existing.map((s) => s.seq)) + 1 : 1;
  const insert = db.prepare('INSERT INTO steps (deployment_id, seq, name) VALUES (?, ?, ?)');
  stepNames.forEach((stepName, idx) => insert.run(deploymentId, nextSeq + idx, stepName));
}
function getDeployment(id) {
  return db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
}

function listDeployments() {
  return db
    .prepare(
      `SELECT d.*, r.label AS role_label,
         (SELECT COUNT(*) FROM deployment_nodes n WHERE n.deployment_id = d.id) AS node_count,
         (SELECT GROUP_CONCAT(n.ip) FROM deployment_nodes n WHERE n.deployment_id = d.id AND n.ip IS NOT NULL) AS node_ips
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

// Bounds timing to the deployment's original steps (seq 1..N) so a later
// component install/reinstall/destroy - which appends more steps to the same
// deployment - doesn't stretch out the reported duration/finish time.
function getInitialRunTiming(deploymentId) {
  return db
    .prepare(
      `SELECT MIN(started_at) AS started_at, MAX(finished_at) AS finished_at
       FROM steps WHERE deployment_id = ? AND seq <= ?`,
    )
    .get(deploymentId, STEP_NAMES.length);
}

const TERMINAL_DEPLOYMENT_STATUSES = ['success', 'failed', 'destroyed'];

function updateDeploymentStatus(id, status) {
  if (status === 'running') {
    // COALESCE keeps the original started_at across retries, so duration reflects
    // the very first attempt rather than resetting on each re-run.
    db.prepare(
      "UPDATE deployments SET status = ?, started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
    ).run(status, id);
  } else if (TERMINAL_DEPLOYMENT_STATUSES.includes(status)) {
    db.prepare(
      "UPDATE deployments SET status = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ).run(status, id);
  } else {
    db.prepare("UPDATE deployments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  }
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

function listComponents() {
  return db.prepare('SELECT * FROM components ORDER BY label').all();
}

function getComponentById(id) {
  return db.prepare('SELECT * FROM components WHERE id = ?').get(id);
}

function getComponentsForRole(roleId) {
  return db
    .prepare(
      `SELECT c.* FROM components c
       JOIN role_components rc ON rc.component_id = c.id
       WHERE rc.role_id = ?
       ORDER BY c.label`,
    )
    .all(roleId);
}

function createRole({ key, label }) {
  const info = db
    .prepare("INSERT INTO roles (key, label, playbook_path, supports_sub_roles) VALUES (?, ?, '', 0)")
    .run(key, label);
  return info.lastInsertRowid;
}

function updateRoleLabel(id, label) {
  db.prepare('UPDATE roles SET label = ? WHERE id = ?').run(label, id);
}

function setRoleDefaultImage(id, imageId) {
  db.prepare('UPDATE roles SET default_image_id = ? WHERE id = ?').run(imageId || null, id);
}

function setRoleComponents(roleId, componentIds) {
  const deleteExisting = db.prepare('DELETE FROM role_components WHERE role_id = ?');
  const insert = db.prepare('INSERT INTO role_components (role_id, component_id) VALUES (?, ?)');
  db.transaction(() => {
    deleteExisting.run(roleId);
    componentIds.forEach((componentId) => insert.run(roleId, componentId));
  })();
}

function getDeploymentComponents(deploymentId) {
  return db
    .prepare(
      `SELECT c.* FROM components c
       JOIN deployment_components dc ON dc.component_id = c.id
       WHERE dc.deployment_id = ?
       ORDER BY c.label`,
    )
    .all(deploymentId);
}

function seedDeploymentComponentsFromRole(deploymentId, roleId) {
  const insert = db.prepare('INSERT OR IGNORE INTO deployment_components (deployment_id, component_id) VALUES (?, ?)');
  getComponentsForRole(roleId).forEach((component) => insert.run(deploymentId, component.id));
}

function addDeploymentComponent(deploymentId, componentId) {
  db.prepare('INSERT OR IGNORE INTO deployment_components (deployment_id, component_id) VALUES (?, ?)').run(
    deploymentId,
    componentId,
  );
}

function removeDeploymentComponent(deploymentId, componentId) {
  db.prepare('DELETE FROM deployment_components WHERE deployment_id = ? AND component_id = ?').run(
    deploymentId,
    componentId,
  );
}

function appendUninstallStep(deploymentId, componentId) {
  const existing = getSteps(deploymentId);
  const nextSeq = existing.length ? Math.max(...existing.map((s) => s.seq)) + 1 : 1;
  db.prepare('INSERT INTO steps (deployment_id, seq, name, params) VALUES (?, ?, ?, ?)').run(
    deploymentId,
    nextSeq,
    'ansible_uninstall',
    JSON.stringify({ componentId }),
  );
}

// Destroyed deployments aren't kept around for history - remove the row and
// everything referencing it once teardown finishes.
const deleteDeployment = db.transaction((id) => {
  db.prepare('DELETE FROM deployment_components WHERE deployment_id = ?').run(id);
  db.prepare('DELETE FROM steps WHERE deployment_id = ?').run(id);
  db.prepare('DELETE FROM deployment_nodes WHERE deployment_id = ?').run(id);
  db.prepare('DELETE FROM deployments WHERE id = ?').run(id);
});

module.exports = {
  STEP_NAMES,
  listRoles,
  getRoleByKey,
  getRoleById,
  createDeployment,
  setWorkdir,
  addNode,
  createSteps,
  appendSteps,
  appendReinstallSteps,
  resetStepsForRetry,
  markDestroyRequested,
  createDestroySteps,
  getDeployment,
  listDeployments,
  getNodes,
  getSteps,
  getInitialRunTiming,
  updateDeploymentStatus,
  updateStep,
  updateNode,
  listComponents,
  getComponentById,
  getComponentsForRole,
  createRole,
  updateRoleLabel,
  setRoleDefaultImage,
  setRoleComponents,
  getDeploymentComponents,
  seedDeploymentComponentsFromRole,
  addDeploymentComponent,
  removeDeploymentComponent,
  deleteDeployment,
  appendUninstallStep,
};
