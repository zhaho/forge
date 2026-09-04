const fs = require('fs');
const path = require('path');
const config = require('../config');

function generateInventory(deployment, nodes, role) {
  const lines = [];

  if (role.key === 'k3s-cluster') {
    const controlPlane = nodes.filter((node) => node.sub_role === 'control-plane');
    const workers = nodes.filter((node) => node.sub_role !== 'control-plane');

    lines.push('[k3s_control_plane]');
    controlPlane.forEach((node) => lines.push(`${node.name} ansible_host=${node.ip}`));
    lines.push('');
    lines.push('[k3s_workers]');
    workers.forEach((node) => lines.push(`${node.name} ansible_host=${node.ip}`));
  } else {
    lines.push('[all]');
    nodes.forEach((node) => lines.push(`${node.name} ansible_host=${node.ip}`));
  }

  lines.push('');
  lines.push('[all:vars]');
  lines.push(`ansible_user=${config.ssh.user}`);
  lines.push(`deploy_user=${config.ssh.user}`);
  lines.push(`ansible_ssh_private_key_file=${config.ssh.privateKeyPath}`);
  lines.push(
    `ansible_ssh_common_args='-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${config.ssh.knownHostsPath}'`,
  );

  const inventoryPath = path.join(deployment.workdir_path, 'inventory.ini');
  fs.writeFileSync(inventoryPath, `${lines.join('\n')}\n`);
  return inventoryPath;
}

module.exports = { generateInventory };
