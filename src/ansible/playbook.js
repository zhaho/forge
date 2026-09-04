const fs = require('fs');
const path = require('path');
const config = require('../config');
const repo = require('../db/deployments');

// Roles with a dedicated playbook (e.g. k3s-cluster) use it directly.
// Everything else is component-based: generate a playbook from the role's
// checked components on the fly - or, if onlyComponentId is given, from just
// that one component (used to reinstall a single failing package).
function resolvePlaybook(deployment, role, onlyComponentId) {
  if (role.playbook_path) {
    return path.join(config.ansiblePlaybooksDir, role.playbook_path);
  }

  let components;
  if (onlyComponentId) {
    const component = repo.getComponentById(onlyComponentId);
    components = component ? [component] : [];
  } else {
    // Deployment's own tracked components, not the role's live list - they
    // diverge once components are installed/removed per-deployment.
    components = repo.getDeploymentComponents(deployment.id);
  }

  const lines = ['---', '- hosts: all', '  become: true'];

  if (components.length === 0) {
    lines.push('  roles: []');
  } else {
    lines.push('  roles:');
    components.forEach((component) => lines.push(`    - ${component.ansible_role}`));
  }

  const playbookPath = path.join(deployment.workdir_path, 'site.yml');
  fs.writeFileSync(playbookPath, `${lines.join('\n')}\n`);
  return playbookPath;
}

function resolveUninstallPlaybook(deployment, componentId) {
  const component = repo.getComponentById(componentId);
  const lines = ['---', '- hosts: all', '  become: true', '  tasks:'];

  if (component) {
    lines.push('    - include_role:');
    lines.push(`        name: ${component.ansible_role}`);
    lines.push('        tasks_from: uninstall');
  }

  const playbookPath = path.join(deployment.workdir_path, 'uninstall.yml');
  fs.writeFileSync(playbookPath, `${lines.join('\n')}\n`);
  return playbookPath;
}

module.exports = { resolvePlaybook, resolveUninstallPlaybook };
