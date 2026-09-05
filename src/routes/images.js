const path = require('path');
const fs = require('fs');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../db/images');
const config = require('../config');
const queue = require('../jobs/queue');
const imagePipeline = require('../jobs/imagePipeline');
const { getEmitter } = require('../jobs/events');
const { formatDuration, formatTimestamp } = require('../utils/duration');

const router = express.Router();

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

// Only allow http(s) URLs - guards against building from a file:// or other
// internal-scheme URL being fed to the Proxmox host's get_url task (SSRF).
function isValidImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function readStepLogs(steps) {
  const blocks = steps
    .filter((step) => step.log_path && fs.existsSync(step.log_path))
    .map((step) => `== ${step.name} (${step.status}) ==\n${fs.readFileSync(step.log_path, 'utf8').trimEnd()}`);
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

router.get('/images', requireAuth, (req, res) => {
  const images = repo.listImages().map((image) => {
    const timing = repo.getInitialRunTiming(image.id);
    return { ...image, duration: formatDuration(timing.started_at, timing.finished_at) };
  });
  res.render('images/index', { images });
});

router.get('/images/new', requireAuth, (req, res) => {
  res.render('images/new', { error: null, form: { name: '', sourceUrl: '' } });
});

router.post('/images', requireAuth, (req, res) => {
  const { name, sourceUrl } = req.body;
  const form = { name, sourceUrl };

  if (!NAME_PATTERN.test(name || '')) {
    return res.render('images/new', {
      form,
      error: 'Name must start with a letter and contain only lowercase letters, numbers, or hyphens (max 32 characters).',
    });
  }
  if (!isValidImageUrl(sourceUrl || '')) {
    return res.render('images/new', { form, error: 'Please enter a valid http(s) image URL.' });
  }

  const imageId = repo.createImage({ name, sourceUrl });
  const workdirPath = path.join(config.dataDir, 'workdirs', 'images', String(imageId));
  fs.mkdirSync(workdirPath, { recursive: true });
  repo.setWorkdir(imageId, workdirPath);
  repo.createSteps(imageId);

  queue.add(() => imagePipeline.runImageBuild(imageId));

  res.redirect(`/images/${imageId}`);
});

router.get('/images/:id', requireAuth, (req, res) => {
  const image = repo.getImage(req.params.id);
  if (!image) return res.status(404).send('Image not found');

  const steps = repo.getSteps(image.id);
  const timing = repo.getInitialRunTiming(image.id);

  res.render('images/show', {
    image: {
      ...image,
      started_at: formatTimestamp(timing.started_at),
      started_at_raw: timing.started_at,
      finished_at: formatTimestamp(timing.finished_at),
      duration: formatDuration(timing.started_at, timing.finished_at),
    },
    steps,
    existingLog: readStepLogs(steps),
  });
});

router.post('/images/:id/retry', requireAuth, (req, res) => {
  const image = repo.getImage(req.params.id);
  if (!image) return res.status(404).send('Image not found');
  if (image.status !== 'failed') {
    return res.status(400).send(`Image is '${image.status}'; only failed image builds can be retried.`);
  }

  const resetSteps = repo.resetStepsForRetry(image.id);
  resetSteps.forEach((step) => fs.rmSync(imagePipeline.stepLogPath(image, step), { force: true }));

  repo.updateImageStatus(image.id, 'queued');
  queue.add(() => imagePipeline.runImageBuild(image.id));

  res.redirect(`/images/${image.id}`);
});

router.post('/images/:id/destroy', requireAuth, (req, res) => {
  const image = repo.getImage(req.params.id);
  if (!image) return res.status(404).send('Image not found');
  if (['running', 'queued', 'destroyed'].includes(image.status)) {
    return res.status(400).send(`Image is currently '${image.status}' and cannot be destroyed right now.`);
  }

  repo.markDestroyRequested(image.id);
  repo.createDestroySteps(image.id);
  queue.add(() => imagePipeline.runImageBuild(image.id));

  res.redirect(`/images/${image.id}`);
});

router.get('/images/:id/events', requireAuth, (req, res) => {
  const imageId = Number(req.params.id);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const emitter = getEmitter(imagePipeline.emitterKey(imageId));
  const onMessage = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  emitter.on('message', onMessage);

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    emitter.off('message', onMessage);
  });
});

module.exports = router;
