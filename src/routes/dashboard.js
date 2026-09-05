const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/deployments');
const { formatDuration, formatShortTimestamp } = require('../utils/duration');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const deployments = repo.listDeployments().map((deployment) => {
    const timing = repo.getInitialRunTiming(deployment.id);
    return {
      ...deployment,
      created_at: formatShortTimestamp(deployment.created_at),
      duration: formatDuration(timing.started_at, timing.finished_at),
    };
  });
  res.render('dashboard', { username: req.session.username, deployments });
});

module.exports = router;
