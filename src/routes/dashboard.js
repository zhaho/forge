const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.render('dashboard', { username: req.session.username, deployments: repo.listDeployments() });
});

module.exports = router;
