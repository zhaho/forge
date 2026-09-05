const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');
const { formatDuration } = require('../utils/duration');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const deployments = repo.listDeployments().map((deployment) => {
    const timing = repo.getInitialRunTiming(deployment.id);
    return { ...deployment, duration: formatDuration(timing.started_at, timing.finished_at) };
  });
  res.render('dashboard', { username: req.session.username, deployments });
});

module.exports = router;
