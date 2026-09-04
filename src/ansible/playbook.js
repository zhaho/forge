const fs = require('fs');
const path = require('path');
const config = require('../config');
const repo = require('../db/deployments');

// Roles with a dedicated playbook (e.g. k3s-cluster) use it directly.
// Everything else is component-based: generate a playbook from the role's
// checked components on the fly.
function resolvePlaybook(deployment, role) {
  if (role.playbook_path) {
    return path.join(config.ansiblePlaybooksDir, role.playbook_path);
  }

  const components = repo.getComponentsForRole(role.id);
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

module.exports = { resolvePlaybook };
