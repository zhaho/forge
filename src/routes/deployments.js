const path = require('path');
const fs = require('fs');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');
const config = require('../config');
const queue = require('../jobs/queue');
const pipeline = require('../jobs/pipeline');
const { getEmitter } = require('../jobs/events');
const { formatDuration, formatTimestamp } = require('../utils/duration');

const router = express.Router();

// Lowercase, starts with a letter, letters/digits/hyphens, short enough to leave
// room for a 2-digit node suffix while staying under typical hostname limits.
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,11}$/;

function readStepLogs(steps) {
  const blocks = steps
    .filter((step) => step.log_path && fs.existsSync(step.log_path))
    .map((step) => `== ${step.name} (${step.status}) ==\n${fs.readFileSync(step.log_path, 'utf8').trimEnd()}`);
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

// Most recent ansible_run step that would have touched this component - either
// one specifically targeting it (params.componentId) or a bulk run (no params,
// covers every component installed at that time). Steps must be seq-ascending.
function getComponentInstallStatus(steps, componentId) {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.name !== 'ansible_run') continue;

    let stepComponentId = null;
    if (step.params) {
      try {
        stepComponentId = JSON.parse(step.params).componentId || null;
      } catch (err) {
        // Malformed params - treat as a bulk run.
      }
    }

    if (stepComponentId === null || stepComponentId === componentId) {
      return step.status;
    }
  }
  return 'pending';
}

router.get('/deployments/new', requireAuth, (req, res) => {
  res.render('deployments/new', {
    roles: repo.listRoles(),
    error: null,
    form: { name: '', roleKey: '', quantity: 1 },
  });
});

router.post('/deployments', requireAuth, (req, res) => {
  const { servername: name, role, quantity } = req.body;
  const roles = repo.listRoles();
  const roleRow = repo.getRoleByKey(role);
  const qty = parseInt(quantity, 10);
  const form = { name, roleKey: role, quantity };

  if (!NAME_PATTERN.test(name || '')) {
    return res.render('deployments/new', {
      roles,
      form,
      error: 'Name must start with a letter and contain only lowercase letters, numbers, or hyphens (max 12 characters).',
    });
  }
  if (!roleRow) {
    return res.render('deployments/new', { roles, form, error: 'Please choose a valid role.' });
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    return res.render('deployments/new', { roles, form, error: 'Quantity must be between 1 and 10.' });
  }

  const deploymentId = repo.createDeployment({
    name,
    roleId: roleRow.id,
    quantity: qty,
    targetNode: config.proxmox.targetNode,
  });

  const workdirPath = path.join(config.dataDir, 'workdirs', String(deploymentId));
  fs.mkdirSync(workdirPath, { recursive: true });
  repo.setWorkdir(deploymentId, workdirPath);

  for (let i = 1; i <= qty; i += 1) {
    const nodeName = `${name}${String(i).padStart(2, '0')}`;
    // k3s-cluster: first node created becomes the control-plane, the rest join as workers.
    const subRole = roleRow.key === 'k3s-cluster' ? (i === 1 ? 'control-plane' : 'worker') : null;
    repo.addNode(deploymentId, nodeName, config.ipam.subnetId, subRole);
  }
  repo.createSteps(deploymentId);
  repo.seedDeploymentComponentsFromRole(deploymentId, roleRow.id);

  queue.add(() => pipeline.runDeployment(deploymentId));

  res.redirect(`/deployments/${deploymentId}`);
});

router.post('/deployments/:id/retry', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');
  if (deployment.status !== 'failed') {
    return res.status(400).send(`Deployment is '${deployment.status}'; only failed deployments can be retried.`);
  }

  const resetSteps = repo.resetStepsForRetry(deployment.id);
  resetSteps.forEach((step) => fs.rmSync(pipeline.stepLogPath(deployment, step), { force: true }));

  repo.updateDeploymentStatus(deployment.id, 'queued');
  queue.add(() => pipeline.runDeployment(deployment.id));

  res.redirect(`/deployments/${deployment.id}`);
});

router.post('/deployments/:id/destroy', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');
  if (['running', 'queued', 'destroyed'].includes(deployment.status)) {
    return res.status(400).send(`Deployment is currently '${deployment.status}' and cannot be destroyed right now.`);
  }

  repo.markDestroyRequested(deployment.id);
  repo.createDestroySteps(deployment.id);
  queue.add(() => pipeline.runDeployment(deployment.id));

  res.redirect(`/deployments/${deployment.id}`);
});

router.post('/deployments/:id/reinstall', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');
  if (['running', 'queued', 'destroyed'].includes(deployment.status)) {
    return res.status(400).send(`Deployment is currently '${deployment.status}' and cannot be reinstalled right now.`);
  }

  repo.appendReinstallSteps(deployment.id, null);
  repo.updateDeploymentStatus(deployment.id, 'queued');
  queue.add(() => pipeline.runDeployment(deployment.id));

  res.redirect(`/deployments/${deployment.id}`);
});

router.post('/deployments/:id/reinstall/:componentId', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');
  if (['running', 'queued', 'destroyed'].includes(deployment.status)) {
    return res.status(400).send(`Deployment is currently '${deployment.status}' and cannot be reinstalled right now.`);
  }

  repo.appendReinstallSteps(deployment.id, Number(req.params.componentId));
  repo.updateDeploymentStatus(deployment.id, 'queued');
  queue.add(() => pipeline.runDeployment(deployment.id));

  res.redirect(`/deployments/${deployment.id}`);
});

router.post('/deployments/:id/components/:componentId/install', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');
  if (['running', 'queued', 'destroyed'].includes(deployment.status)) {
    return res.status(400).send(`Deployment is currently '${deployment.status}' and cannot be changed right now.`);
  }

  const componentId = Number(req.params.componentId);
  repo.addDeploymentComponent(deployment.id, componentId);
  repo.appendReinstallSteps(deployment.id, componentId);
  repo.updateDeploymentStatus(deployment.id, 'queued');
  queue.add(() => pipeline.runDeployment(deployment.id));

  res.redirect(`/deployments/${deployment.id}`);
});

router.post('/deployments/:id/components/:componentId/uninstall', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');
  if (['running', 'queued', 'destroyed'].includes(deployment.status)) {
    return res.status(400).send(`Deployment is currently '${deployment.status}' and cannot be changed right now.`);
  }

  repo.appendUninstallStep(deployment.id, Number(req.params.componentId));
  repo.updateDeploymentStatus(deployment.id, 'queued');
  queue.add(() => pipeline.runDeployment(deployment.id));

  res.redirect(`/deployments/${deployment.id}`);
});

router.get('/deployments/:id', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');

  const steps = repo.getSteps(deployment.id);
  const role = repo.getRoleById(deployment.role_id);
  const installedComponents = (role.playbook_path ? [] : repo.getDeploymentComponents(deployment.id)).map(
    (component) => ({ ...component, installStatus: getComponentInstallStatus(steps, component.id) }),
  );
  const installedIds = new Set(installedComponents.map((c) => c.id));
  const availableComponents = role.playbook_path
    ? []
    : repo.listComponents().filter((c) => !installedIds.has(c.id));

  const timing = repo.getInitialRunTiming(deployment.id);

  res.render('deployments/show', {
    deployment: {
      ...deployment,
      started_at: formatTimestamp(timing.started_at),
      finished_at: formatTimestamp(timing.finished_at),
      duration: formatDuration(timing.started_at, timing.finished_at),
    },
    role,
    installedComponents,
    availableComponents,
    nodes: repo.getNodes(deployment.id),
    steps,
    existingLog: readStepLogs(steps),
  });
});

router.get('/deployments/:id/events', requireAuth, (req, res) => {
  const deploymentId = Number(req.params.id);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const emitter = getEmitter(deploymentId);
  const onMessage = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  emitter.on('message', onMessage);

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    emitter.off('message', onMessage);
  });
});

module.exports = router;
