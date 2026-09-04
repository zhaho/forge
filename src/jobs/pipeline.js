const fs = require('fs');
const path = require('path');
const config = require('../config');
const repo = require('../db/deployments');
const ipam = require('../ipam/client');
const generator = require('../terraform/generator');
const { runCommand } = require('../terraform/executor');
const { getEmitter } = require('./events');

function emit(deploymentId, event) {
  getEmitter(deploymentId).emit('message', event);
}

function stepLogPath(deployment, step) {
  const logDir = path.join(config.dataDir, 'logs', String(deployment.id));
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `${String(step.seq).padStart(2, '0')}-${step.name}.log`);
}

function appendLog(logPath, line) {
  fs.appendFileSync(logPath, `${line}\n`);
}

function markStepRunning(deployment, step) {
  const logPath = stepLogPath(deployment, step);
  repo.updateStep(step.id, { status: 'running', started_at: new Date().toISOString(), log_path: logPath });
  emit(deployment.id, { type: 'step', seq: step.seq, name: step.name, status: 'running' });
  return logPath;
}

function markStepDone(deployment, step, status) {
  repo.updateStep(step.id, { status, finished_at: new Date().toISOString() });
  emit(deployment.id, { type: 'step', seq: step.seq, name: step.name, status });
}

async function allocateIpForNode(deployment, node, logPath, step) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ip = await ipam.firstFreeIp(node.subnet_id);
    try {
      await ipam.registerIp(node.subnet_id, ip, node.name, `VM ${node.name} deployed by Forge`);
      return ip;
    } catch (err) {
      if (err.alreadyExists && attempt < maxAttempts) {
        const line = `${ip} was claimed by another allocation just now, retrying...`;
        appendLog(logPath, line);
        emit(deployment.id, { type: 'log', step: step.name, line });
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not find a free IP for ${node.name} after ${maxAttempts} attempts`);
}

async function runAllocateIps(deployment, step, logPath) {
  const nodes = repo.getNodes(deployment.id);
  for (const node of nodes) {
    if (node.ip) continue;
    const line = `Requesting a free IP from IPAM subnet ${node.subnet_id} for ${node.name}...`;
    appendLog(logPath, line);
    emit(deployment.id, { type: 'log', step: step.name, line });

    const ip = await allocateIpForNode(deployment, node, logPath, step);
    repo.updateNode(node.id, { ip });

    const assignedLine = `${node.name} -> ${ip}`;
    appendLog(logPath, assignedLine);
    emit(deployment.id, { type: 'log', step: step.name, line: assignedLine });
  }
}

async function runGenerateTerraform(deployment, step, logPath) {
  const nodes = repo.getNodes(deployment.id);
  const role = repo.getRoleById(deployment.role_id);
  generator.generateWorkdir(deployment, nodes, role);
  const line = `Generated Terraform configuration in ${deployment.workdir_path}`;
  appendLog(logPath, line);
  emit(deployment.id, { type: 'log', step: step.name, line });
}

function terraformEnv() {
  return {
    TF_VAR_pm_api_token_secret: config.proxmox.tokenSecret,
    TF_VAR_ipam_password: config.ipam.password,
    TF_IN_AUTOMATION: 'true',
  };
}

async function runTerraformInit(deployment, step, logPath) {
  await runCommand(
    'terraform',
    ['init', '-input=false', '-no-color'],
    deployment.workdir_path,
    terraformEnv(),
    logPath,
    (line) => emit(deployment.id, { type: 'log', step: step.name, line }),
  );
}

async function runTerraformApply(deployment, step, logPath) {
  await runCommand(
    'terraform',
    ['apply', '-auto-approve', '-input=false', '-no-color'],
    deployment.workdir_path,
    terraformEnv(),
    logPath,
    (line) => emit(deployment.id, { type: 'log', step: step.name, line }),
  );
  repo.getNodes(deployment.id).forEach((node) => repo.updateNode(node.id, { status: 'ready' }));
}

async function runTerraformDestroy(deployment, step, logPath) {
  await runCommand(
    'terraform',
    ['destroy', '-auto-approve', '-input=false', '-no-color'],
    deployment.workdir_path,
    terraformEnv(),
    logPath,
    (line) => emit(deployment.id, { type: 'log', step: step.name, line }),
  );
}

async function runMarkDestroyed(deployment, step, logPath) {
  repo.getNodes(deployment.id).forEach((node) => repo.updateNode(node.id, { status: 'destroyed' }));
  const line = `All nodes for ${deployment.name} marked as destroyed.`;
  appendLog(logPath, line);
  emit(deployment.id, { type: 'log', step: step.name, line });
}

const STEP_RUNNERS = {
  allocate_ips: runAllocateIps,
  generate_terraform: runGenerateTerraform,
  terraform_init: runTerraformInit,
  terraform_apply: runTerraformApply,
  terraform_destroy: runTerraformDestroy,
  mark_destroyed: runMarkDestroyed,
};

async function runDeployment(deploymentId) {
  const deployment = repo.getDeployment(deploymentId);
  repo.updateDeploymentStatus(deploymentId, 'running');
  emit(deploymentId, { type: 'deployment', status: 'running' });

  const steps = repo.getSteps(deploymentId).filter((step) => step.status === 'pending');

  for (const step of steps) {
    const logPath = markStepRunning(deployment, step);
    try {
      await STEP_RUNNERS[step.name](deployment, step, logPath);
      markStepDone(deployment, step, 'success');
    } catch (err) {
      appendLog(logPath, `ERROR: ${err.message}`);
      emit(deploymentId, { type: 'log', step: step.name, line: `ERROR: ${err.message}` });
      markStepDone(deployment, step, 'failed');
      repo.updateDeploymentStatus(deploymentId, 'failed');
      emit(deploymentId, { type: 'deployment', status: 'failed' });
      return;
    }
  }

  const finalStatus = deployment.action === 'destroy' ? 'destroyed' : 'success';
  repo.updateDeploymentStatus(deploymentId, finalStatus);
  emit(deploymentId, { type: 'deployment', status: finalStatus });
}

module.exports = { runDeployment };
