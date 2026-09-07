const fs = require('fs');
const path = require('path');
const config = require('../config');
const repo = require('../db/deployments');
const ipam = require('../ipam/client');
const generator = require('../terraform/generator');
const { runCommand } = require('../terraform/executor');
const inventory = require('../ansible/inventory');
const playbookModule = require('../ansible/playbook');
const { getEmitter } = require('./events');

const MAX_SSH_ATTEMPTS = 30;
const SSH_RETRY_DELAY_MS = 10000;
// Some node/image combos occasionally clone with a stuck netplan/cloud-init
// network config on first boot (seen with concurrent multi-node clones from
// the same template); a Proxmox-side reboot after a few failed attempts kicks
// it loose, mirroring what the old ansible-proxmox-deploy pipeline did for
// every VM unconditionally.
const REBOOT_AFTER_ATTEMPTS = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function sshArgs(node) {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `UserKnownHostsFile=${config.ssh.knownHostsPath}`,
    '-i',
    config.ssh.privateKeyPath,
    `${config.ssh.user}@${node.ip}`,
    // cloud-init status --wait exits 2 for "degraded done" (recoverable errors
    // only, e.g. Proxmox's ciuser field triggering a harmless deprecation
    // warning) - only exit 1 (real failure) should count as not-ready.
    'cloud-init status --wait; ec=$?; [ "$ec" -eq 0 ] || [ "$ec" -eq 2 ]',
  ];
}

async function forgetStaleHostKey(deployment, node, logPath, stepName) {
  if (!fs.existsSync(config.ssh.knownHostsPath)) fs.writeFileSync(config.ssh.knownHostsPath, '');
  try {
    // Home-lab IPs get reused across VMs; a stale known_hosts entry from a
    // previous VM at the same IP would otherwise hard-fail host key checking.
    await runCommand(
      'ssh-keygen',
      ['-R', node.ip, '-f', config.ssh.knownHostsPath],
      deployment.workdir_path,
      {},
      logPath,
      (l) => emit(deployment.id, { type: 'log', step: stepName, line: l }),
    );
  } catch (err) {
    // No existing entry to remove - fine, nothing to do.
  }
}

function proxmoxHostSshArgs() {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `UserKnownHostsFile=${config.ssh.knownHostsPath}`,
    '-i',
    config.ssh.privateKeyPath,
    `${config.proxmox.sshUser}@${config.proxmox.sshHost}`,
  ];
}

// Looks up node.name's VMID via the Proxmox host and issues a reboot, to kick
// loose a stuck first-boot network config. Best-effort: returns false (never
// throws) so a lookup/reboot failure doesn't derail the SSH retry loop itself.
async function rebootNodeOnProxmox(deployment, node, logPath, stepName) {
  if (!config.proxmox.sshHost) return false;
  try {
    const lines = [];
    await runCommand(
      'ssh',
      [...proxmoxHostSshArgs(), 'pvesh get /cluster/resources --type vm --output-format json'],
      deployment.workdir_path,
      {},
      logPath,
      (l) => lines.push(l),
    );
    const vm = JSON.parse(lines.join('\n')).find((v) => v.name === node.name);
    if (!vm) return false;

    const line = `${node.name} still unreachable after ${REBOOT_AFTER_ATTEMPTS} attempts - rebooting VM ${vm.vmid} on Proxmox to clear a stuck network config...`;
    appendLog(logPath, line);
    emit(deployment.id, { type: 'log', step: stepName, line });

    await runCommand(
      'ssh',
      [...proxmoxHostSshArgs(), `qm reboot ${vm.vmid}`],
      deployment.workdir_path,
      {},
      logPath,
      (l) => emit(deployment.id, { type: 'log', step: stepName, line: l }),
    );
    return true;
  } catch (err) {
    appendLog(logPath, `Could not reboot ${node.name} via Proxmox: ${err.message}`);
    return false;
  }
}

async function runWaitCloudInit(deployment, step, logPath) {
  fs.mkdirSync(path.dirname(config.ssh.knownHostsPath), { recursive: true });
  const nodes = repo.getNodes(deployment.id);

  for (const node of nodes) {
    const line = `Waiting for SSH + cloud-init on ${node.name} (${node.ip})...`;
    appendLog(logPath, line);
    emit(deployment.id, { type: 'log', step: step.name, line });

    await forgetStaleHostKey(deployment, node, logPath, step.name);

    let lastErr;
    let rebooted = false;
    for (let attempt = 1; attempt <= MAX_SSH_ATTEMPTS; attempt += 1) {
      try {
        await runCommand('ssh', sshArgs(node), deployment.workdir_path, {}, logPath, (l) =>
          emit(deployment.id, { type: 'log', step: step.name, line: l }),
        );
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!rebooted && attempt === REBOOT_AFTER_ATTEMPTS) {
          rebooted = await rebootNodeOnProxmox(deployment, node, logPath, step.name);
        }
        if (attempt < MAX_SSH_ATTEMPTS) await sleep(SSH_RETRY_DELAY_MS);
      }
    }
    if (lastErr) throw new Error(`${node.name} did not become reachable over SSH: ${lastErr.message}`);
  }
}

function ansibleEnv() {
  return {
    ANSIBLE_CONFIG: config.ansibleConfigPath,
    ANSIBLE_ROLES_PATH: config.ansibleRolesPath,
    ANSIBLE_NOCOLOR: '1',
    PYTHONUNBUFFERED: '1',
  };
}

async function runAnsible(deployment, step, logPath) {
  const nodes = repo.getNodes(deployment.id);
  const role = repo.getRoleById(deployment.role_id);
  const inventoryPath = inventory.generateInventory(deployment, nodes, role);

  let componentId = null;
  if (step.params) {
    try {
      componentId = JSON.parse(step.params).componentId || null;
    } catch (err) {
      // Malformed/legacy params - fall back to the role's full component list.
    }
  }

  if (componentId) {
    const component = repo.getComponentById(componentId);
    const line = `Reinstalling just the '${component ? component.label : componentId}' component`;
    appendLog(logPath, line);
    emit(deployment.id, { type: 'log', step: step.name, line });
  }

  const playbookPath = playbookModule.resolvePlaybook(deployment, role, componentId);

  await runCommand(
    'ansible-playbook',
    ['-i', inventoryPath, playbookPath],
    deployment.workdir_path,
    ansibleEnv(),
    logPath,
    (line) => emit(deployment.id, { type: 'log', step: step.name, line }),
  );
}

async function runAnsibleUninstall(deployment, step, logPath) {
  let componentId = null;
  if (step.params) {
    try {
      componentId = JSON.parse(step.params).componentId || null;
    } catch (err) {
      // Malformed params - nothing sensible to uninstall.
    }
  }
  if (!componentId) throw new Error('Uninstall step is missing a componentId');

  const nodes = repo.getNodes(deployment.id);
  const role = repo.getRoleById(deployment.role_id);
  const inventoryPath = inventory.generateInventory(deployment, nodes, role);

  const component = repo.getComponentById(componentId);
  const line = `Uninstalling '${component ? component.label : componentId}'`;
  appendLog(logPath, line);
  emit(deployment.id, { type: 'log', step: step.name, line });

  const playbookPath = playbookModule.resolveUninstallPlaybook(deployment, componentId);

  await runCommand(
    'ansible-playbook',
    ['-i', inventoryPath, playbookPath],
    deployment.workdir_path,
    ansibleEnv(),
    logPath,
    (l) => emit(deployment.id, { type: 'log', step: step.name, line: l }),
  );

  repo.removeDeploymentComponent(deployment.id, componentId);
}

async function runVerify(deployment, step, logPath) {
  const inventoryPath = path.join(deployment.workdir_path, 'inventory.ini');

  await runCommand(
    'ansible',
    ['all', '-i', inventoryPath, '-m', 'ping'],
    deployment.workdir_path,
    ansibleEnv(),
    logPath,
    (line) => emit(deployment.id, { type: 'log', step: step.name, line }),
  );
}

const STEP_RUNNERS = {
  allocate_ips: runAllocateIps,
  generate_terraform: runGenerateTerraform,
  terraform_init: runTerraformInit,
  terraform_apply: runTerraformApply,
  wait_cloud_init: runWaitCloudInit,
  ansible_run: runAnsible,
  ansible_uninstall: runAnsibleUninstall,
  verify: runVerify,
  terraform_destroy: runTerraformDestroy,
  mark_destroyed: runMarkDestroyed,
};

async function runDeployment(deploymentId) {
  const deployment = repo.getDeployment(deploymentId);
  // Older deployments may have a relative workdir_path stored (pre path-resolve fix);
  // normalize it here so every step below gets a consistent absolute path.
  deployment.workdir_path = path.resolve(deployment.workdir_path);
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
  if (finalStatus === 'destroyed') {
    emit(deploymentId, { type: 'deployment', status: 'destroyed' });
    // Destroyed deployments aren't kept around for history.
    repo.deleteDeployment(deploymentId);
    return;
  }
  repo.updateDeploymentStatus(deploymentId, finalStatus);
  emit(deploymentId, { type: 'deployment', status: finalStatus });
}

module.exports = { runDeployment, stepLogPath };
