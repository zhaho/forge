const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');
const imagesRepo = require('../db/images');

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
    images: imagesRepo.listAvailableImages(),
    error: null,
    form: { key: '', label: '', componentIds: [], defaultImageId: '' },
  });
});

router.post('/roles', requireAuth, (req, res) => {
  const { key, label, defaultImageId } = req.body;
  const componentIds = [].concat(req.body.componentIds || []).map(Number);
  const components = repo.listComponents();
  const images = imagesRepo.listAvailableImages();

  if (!KEY_PATTERN.test(key || '')) {
    return res.render('roles/new', {
      components,
      images,
      form: { key, label, componentIds, defaultImageId },
      error: 'Key must start with a letter and contain only lowercase letters, numbers, or hyphens (max 20 characters).',
    });
  }
  if (repo.getRoleByKey(key)) {
    return res.render('roles/new', {
      components,
      images,
      form: { key, label, componentIds, defaultImageId },
      error: `A role with key '${key}' already exists.`,
    });
  }
  if (!label || !label.trim()) {
    return res.render('roles/new', {
      components,
      images,
      form: { key, label, componentIds, defaultImageId },
      error: 'Label is required.',
    });
  }

  const roleId = repo.createRole({ key, label: label.trim() });
  repo.setRoleComponents(roleId, componentIds);
  repo.setRoleDefaultImage(roleId, defaultImageId ? Number(defaultImageId) : null);

  res.redirect('/roles');
});

router.get('/roles/:id/edit', requireAuth, (req, res) => {
  const role = repo.getRoleById(req.params.id);
  if (!role) return res.status(404).send('Role not found');

  const images = imagesRepo.listAvailableImages();

  if (role.playbook_path) {
    return res.render('roles/edit-dedicated', {
      role,
      images,
      error: null,
      form: { defaultImageId: role.default_image_id || '' },
    });
  }

  const selectedIds = repo.getComponentsForRole(role.id).map((c) => c.id);
  res.render('roles/edit', {
    role,
    components: repo.listComponents(),
    images,
    error: null,
    form: { label: role.label, componentIds: selectedIds, defaultImageId: role.default_image_id || '' },
  });
});

router.post('/roles/:id', requireAuth, (req, res) => {
  const role = repo.getRoleById(req.params.id);
  if (!role) return res.status(404).send('Role not found');

  const { defaultImageId } = req.body;

  if (role.playbook_path) {
    repo.setRoleDefaultImage(role.id, defaultImageId ? Number(defaultImageId) : null);
    return res.redirect('/roles');
  }

  const { label } = req.body;
  const componentIds = [].concat(req.body.componentIds || []).map(Number);
  const images = imagesRepo.listAvailableImages();

  if (!label || !label.trim()) {
    return res.render('roles/edit', {
      role,
      components: repo.listComponents(),
      images,
      form: { label, componentIds, defaultImageId },
      error: 'Label is required.',
    });
  }

  repo.updateRoleLabel(role.id, label.trim());
  repo.setRoleComponents(role.id, componentIds);
  repo.setRoleDefaultImage(role.id, defaultImageId ? Number(defaultImageId) : null);

  res.redirect('/roles');
});

module.exports = router;
