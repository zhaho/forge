(function () {
  var imageId = window.FORGE_IMAGE_ID;
  if (!imageId) return;

  // Keep in sync with src/views/partials/status-badge.ejs
  var STATUS_BADGE_CLASS = {
    success: 'badge-success',
    failed: 'badge-error',
    interrupted: 'badge-error',
    running: 'badge-info',
    queued: 'badge-info',
    destroyed: 'bg-base-300 border-base-300 text-base-content/50',
    pending: 'bg-base-300 border-base-300 text-base-content/80',
    ready: 'badge-success',
  };

  function badgeClassFor(status) {
    return (
      'badge rounded-sm items-center justify-center text-center leading-none ' +
      (STATUS_BADGE_CLASS[status] || 'bg-base-300 border-base-300 text-base-content/80')
    );
  }

  // Keep in sync with the stepDotClass map in images/show.ejs
  var STEP_DOT_CLASS = {
    success: 'step-success',
    failed: 'step-error',
    interrupted: 'step-error',
    running: 'step-info',
    queued: 'step-info',
  };

  // Keep in sync with the stepAnimClass map in images/show.ejs
  var STEP_ANIM_CLASS = {
    running: 'step-active-pulse',
  };

  function updateStepsProgress() {
    var stepEls = document.querySelectorAll('[data-step]');
    var barEl = document.getElementById('steps-progress-bar');
    if (!barEl || !stepEls.length) return;
    var done = 0;
    stepEls.forEach(function (el) {
      if (el.classList.contains('step-success')) done += 1;
    });
    barEl.style.width = Math.round((done / stepEls.length) * 100) + '%';
  }

  function formatElapsed(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    var parts = [];
    if (h) parts.push(h + 'h');
    if (h || m) parts.push(m + 'm');
    parts.push(s + 's');
    return parts.join(' ');
  }

  // Ticks a live "Running for Xm Ys" counter while a build is in progress.
  var startedAtRaw = window.FORGE_IMAGE_STARTED_AT;
  var startedAtMs = startedAtRaw ? new Date(startedAtRaw.replace(' ', 'T') + 'Z').getTime() : null;
  var elapsedInterval = null;

  function tickElapsed() {
    var el = document.getElementById('elapsed-text');
    if (!el || startedAtMs === null) return;
    el.textContent = 'Running for ' + formatElapsed(Date.now() - startedAtMs);
  }

  function startElapsedTimer() {
    if (elapsedInterval) return;
    tickElapsed();
    elapsedInterval = setInterval(tickElapsed, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  if (startedAtMs !== null) startElapsedTimer();

  var logEl = document.getElementById('log');
  var source = new EventSource('/images/' + imageId + '/events');

  source.onmessage = function (event) {
    var msg = JSON.parse(event.data);

    if (msg.type === 'log') {
      logEl.textContent += msg.line + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    } else if (msg.type === 'step') {
      var stepEl = document.querySelector('[data-step="' + msg.seq + '"]');
      if (stepEl) {
        stepEl.className = 'step ' + (STEP_DOT_CLASS[msg.status] || '') + ' ' + (STEP_ANIM_CLASS[msg.status] || '');
        var spinnerEl = stepEl.querySelector('.loading');
        if (msg.status === 'running' && !spinnerEl) {
          spinnerEl = document.createElement('span');
          spinnerEl.className = 'loading loading-spinner loading-xs text-info';
          stepEl.querySelector('span').appendChild(spinnerEl);
        } else if (msg.status !== 'running' && spinnerEl) {
          spinnerEl.remove();
        }
      }
      var stepStatusEl = document.querySelector('[data-step="' + msg.seq + '"] .status-badge');
      if (stepStatusEl) {
        stepStatusEl.textContent = msg.status;
        stepStatusEl.className = 'status-badge ' + badgeClassFor(msg.status);
      }
      updateStepsProgress();
      if (msg.status === 'running' && startedAtMs === null) {
        startedAtMs = Date.now();
        startElapsedTimer();
      }
    } else if (msg.type === 'image') {
      var imageStatusEl = document.getElementById('image-status');
      if (imageStatusEl) {
        imageStatusEl.textContent = msg.status;
        imageStatusEl.className = badgeClassFor(msg.status);
      }
      var progressTrackEl = document.getElementById('steps-progress-track');
      if (progressTrackEl) {
        progressTrackEl.classList.toggle('hidden', !['running', 'queued'].includes(msg.status));
      }
      var progressBarEl = document.getElementById('steps-progress-bar');
      if (progressBarEl) {
        progressBarEl.classList.toggle('steps-progress-active', msg.status === 'running');
      }
      if (msg.status === 'success' || msg.status === 'failed') {
        source.close();
        location.reload();
      } else if (msg.status === 'destroyed') {
        stopElapsedTimer();
        source.close();
        location.href = '/images';
      }
    }
  };
})();
