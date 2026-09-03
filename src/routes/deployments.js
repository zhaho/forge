const path = require('path');
const fs = require('fs');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');
const config = require('../config');
const queue = require('../jobs/queue');
const pipeline = require('../jobs/pipeline');
const { getEmitter } = require('../jobs/events');

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

router.get('/deployments/new', requireAuth, (req, res) => {
  res.render('deployments/new', {
    roles: repo.listRoles(),
    error: null,
    form: { name: '', roleKey: '', quantity: 1 },
  });
});

router.post('/deployments', requireAuth, (req, res) => {
  const { name, role, quantity } = req.body;
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
    repo.addNode(deploymentId, nodeName, config.ipam.subnetId);
  }
  repo.createSteps(deploymentId);

  queue.add(() => pipeline.runDeployment(deploymentId));

  res.redirect(`/deployments/${deploymentId}`);
});

router.get('/deployments/:id', requireAuth, (req, res) => {
  const deployment = repo.getDeployment(req.params.id);
  if (!deployment) return res.status(404).send('Deployment not found');

  const steps = repo.getSteps(deployment.id);

  res.render('deployments/show', {
    deployment,
    role: repo.getRoleById(deployment.role_id),
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
