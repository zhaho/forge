const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const repo = require('../db/images');
const { runCommand } = require('../terraform/executor');
const { getEmitter } = require('./events');

// Images use their own emitter namespace so image/deployment ids (both start
// at 1) never collide on the same in-process EventEmitter.
function emitterKey(imageId) {
  return `image-${imageId}`;
}

function emit(imageId, event) {
  getEmitter(emitterKey(imageId)).emit('message', event);
}

function stepLogPath(image, step) {
  const logDir = path.join(config.dataDir, 'logs', 'images', String(image.id));
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `${String(step.seq).padStart(2, '0')}-${step.name}.log`);
}

function appendLog(logPath, line) {
  fs.appendFileSync(logPath, `${line}\n`);
}

function markStepRunning(image, step) {
  const logPath = stepLogPath(image, step);
  repo.updateStep(step.id, { status: 'running', started_at: new Date().toISOString(), log_path: logPath });
  emit(image.id, { type: 'step', seq: step.seq, name: step.name, status: 'running' });
  return logPath;
}

function markStepDone(image, step, status) {
  repo.updateStep(step.id, { status, finished_at: new Date().toISOString() });
  emit(image.id, { type: 'step', seq: step.seq, name: step.name, status });
}

function sshBaseArgs() {
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

// Runs a single command on the Proxmox host over SSH, returning its output
// lines (in addition to logging/streaming them like every other step).
async function runOnProxmoxHost(image, step, logPath, remoteCommand) {
  const lines = [];
  await runCommand('ssh', [...sshBaseArgs(), remoteCommand], config.dataDir, {}, logPath, (line) => {
    lines.push(line);
    emit(image.id, { type: 'log', step: step.name, line });
  });
  return lines;
}

function requireProxmoxSshHost() {
  if (!config.proxmox.sshHost) {
    throw new Error('PROXMOX_SSH_HOST is not configured - cannot reach the Proxmox host to manage images.');
  }
}

async function runAllocateVmid(image, step, logPath) {
  requireProxmoxSshHost();
  const lines = await runOnProxmoxHost(
    image,
    step,
    logPath,
    'pvesh get /cluster/resources --type vm --output-format json',
  );

  let usedVmids;
  try {
    usedVmids = new Set(JSON.parse(lines.join('\n')).map((vm) => vm.vmid));
  } catch (err) {
    throw new Error(`Could not parse Proxmox's VM list: ${lines.join(' ')}`);
  }

  let vmid = config.image.vmidRangeStart;
  while (usedVmids.has(vmid)) vmid += 1;

  repo.setVmId(image.id, vmid);
  image.vm_id = vmid;
  const line = `Allocated Proxmox VMID ${vmid} (first free ID >= ${config.image.vmidRangeStart})`;
  appendLog(logPath, line);
  emit(image.id, { type: 'log', step: step.name, line });
}

function getSshPublicKey() {
  return new Promise((resolve, reject) => {
    execFile('ssh-keygen', ['-y', '-f', config.ssh.privateKeyPath], (err, stdout) => {
      if (err) return reject(new Error(`Could not derive the SSH public key: ${err.message}`));
      resolve(stdout.trim());
    });
  });
}

async function runBuildTemplate(image, step, logPath) {
  requireProxmoxSshHost();
  const publicKey = await getSshPublicKey();

  const inventoryPath = path.join(image.workdir_path, 'inventory.ini');
  fs.writeFileSync(
    inventoryPath,
    [
      '[proxmox]',
      `proxmoxhost ansible_host=${config.proxmox.sshHost} ansible_user=${config.proxmox.sshUser} ansible_python_interpreter=/usr/bin/python3`,
      '',
      '[proxmox:vars]',
      `ansible_ssh_private_key_file=${config.ssh.privateKeyPath}`,
      `ansible_ssh_common_args='-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${config.ssh.knownHostsPath}'`,
      '',
    ].join('\n'),
  );

  // Extra vars go in a file rather than -e on the command line so the
  // cloud-init password (if set) never ends up visible in the process list.
  const varsPath = path.join(image.workdir_path, 'extra-vars.json');
  fs.writeFileSync(
    varsPath,
    JSON.stringify({
      image_url: image.source_url,
      vm_id: image.vm_id,
      vm_name: image.name,
      vm_memory: config.image.vmMemory,
      vm_network_bridge: config.proxmox.networkBridge,
      vm_datastore: config.proxmox.datastore,
      vm_disksize: config.image.vmDiskSize,
      ci_user: config.image.ciUser,
      ci_password: config.image.ciPassword,
      ci_upgrade: config.image.ciUpgrade,
      ci_ipconfig: config.image.ciIpConfig,
      ssh_public_key: publicKey,
    }),
  );

  try {
    await runCommand(
      'ansible-playbook',
      ['-i', inventoryPath, path.join(config.ansiblePlaybooksDir, 'build-image.yml'), '--extra-vars', `@${varsPath}`],
      image.workdir_path,
      {
        ANSIBLE_CONFIG: config.ansibleConfigPath,
        ANSIBLE_ROLES_PATH: config.ansibleRolesPath,
        ANSIBLE_NOCOLOR: '1',
        PYTHONUNBUFFERED: '1',
      },
      logPath,
      (line) => emit(image.id, { type: 'log', step: step.name, line }),
    );
  } finally {
    fs.rmSync(varsPath, { force: true });
  }
}

async function runVerify(image, step, logPath) {
  requireProxmoxSshHost();
  const lines = await runOnProxmoxHost(image, step, logPath, `qm config ${image.vm_id}`);
  if (!lines.some((line) => /^template:\s*1/.test(line))) {
    throw new Error(`VM ${image.vm_id} does not look like a template yet.`);
  }
}

async function runDestroyTemplate(image, step, logPath) {
  requireProxmoxSshHost();
  await runOnProxmoxHost(image, step, logPath, `qm destroy ${image.vm_id} --purge`);
}

const STEP_RUNNERS = {
  allocate_vmid: runAllocateVmid,
  build_template: runBuildTemplate,
  verify: runVerify,
  destroy_template: runDestroyTemplate,
};

async function runImageBuild(imageId) {
  const image = repo.getImage(imageId);
  image.workdir_path = path.resolve(image.workdir_path);
  repo.updateImageStatus(imageId, 'running');
  emit(imageId, { type: 'image', status: 'running' });

  const steps = repo.getSteps(imageId).filter((step) => step.status === 'pending');

  for (const step of steps) {
    const logPath = markStepRunning(image, step);
    try {
      await STEP_RUNNERS[step.name](image, step, logPath);
      markStepDone(image, step, 'success');
    } catch (err) {
      appendLog(logPath, `ERROR: ${err.message}`);
      emit(imageId, { type: 'log', step: step.name, line: `ERROR: ${err.message}` });
      markStepDone(image, step, 'failed');
      repo.updateImageStatus(imageId, 'failed');
      emit(imageId, { type: 'image', status: 'failed' });
      return;
    }
  }

  const finalStatus = image.action === 'destroy' ? 'destroyed' : 'success';
  if (finalStatus === 'destroyed') {
    emit(imageId, { type: 'image', status: 'destroyed' });
    // Destroyed images aren't kept around for history.
    repo.deleteImage(imageId);
    return;
  }
  repo.updateImageStatus(imageId, finalStatus);
  emit(imageId, { type: 'image', status: finalStatus });
}

module.exports = { runImageBuild, stepLogPath, emitterKey };
