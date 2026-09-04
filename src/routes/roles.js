const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');

const router = express.Router();

// Lowercase key used as the dropdown value; short and URL-safe.
const KEY_PATTERN = /^[a-z][a-z0-9-]{1,19}$/;

router.get('/roles', requireAuth, (req, res) => {
  const roles = repo.listRoles().map((role) => ({
    ...role,
    isComponentBased: !role.playbook_path,
    components: role.playbook_path ? [] : repo.getComponentsForRole(role.id),
  }));
  res.render('roles/index', { roles });
});

router.get('/roles/new', requireAuth, (req, res) => {
  res.render('roles/new', {
    components: repo.listComponents(),
    error: null,
    form: { key: '', label: '', componentIds: [] },
  });
});

router.post('/roles', requireAuth, (req, res) => {
  const { key, label } = req.body;
  const componentIds = [].concat(req.body.componentIds || []).map(Number);
  const components = repo.listComponents();

  if (!KEY_PATTERN.test(key || '')) {
    return res.render('roles/new', {
      components,
      form: { key, label, componentIds },
      error: 'Key must start with a letter and contain only lowercase letters, numbers, or hyphens (max 20 characters).',
    });
  }
  if (repo.getRoleByKey(key)) {
    return res.render('roles/new', {
      components,
      form: { key, label, componentIds },
      error: `A role with key '${key}' already exists.`,
    });
  }
  if (!label || !label.trim()) {
    return res.render('roles/new', { components, form: { key, label, componentIds }, error: 'Label is required.' });
  }

  const roleId = repo.createRole({ key, label: label.trim() });
  repo.setRoleComponents(roleId, componentIds);

  res.redirect('/roles');
});

router.get('/roles/:id/edit', requireAuth, (req, res) => {
  const role = repo.getRoleById(req.params.id);
  if (!role) return res.status(404).send('Role not found');

  if (role.playbook_path) {
    return res.render('roles/edit-dedicated', { role });
  }

  const selectedIds = repo.getComponentsForRole(role.id).map((c) => c.id);
  res.render('roles/edit', {
    role,
    components: repo.listComponents(),
    error: null,
    form: { label: role.label, componentIds: selectedIds },
  });
});

router.post('/roles/:id', requireAuth, (req, res) => {
  const role = repo.getRoleById(req.params.id);
  if (!role) return res.status(404).send('Role not found');
  if (role.playbook_path) return res.status(400).send('This role uses a dedicated playbook and cannot be edited here.');

  const { label } = req.body;
  const componentIds = [].concat(req.body.componentIds || []).map(Number);

  if (!label || !label.trim()) {
    return res.render('roles/edit', {
      role,
      components: repo.listComponents(),
      form: { label, componentIds },
      error: 'Label is required.',
    });
  }

  repo.updateRoleLabel(role.id, label.trim());
  repo.setRoleComponents(role.id, componentIds);

  res.redirect('/roles');
});

module.exports = router;
