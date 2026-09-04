(function () {
  var deploymentId = window.FORGE_DEPLOYMENT_ID;
  if (!deploymentId) return;

  // Keep in sync with src/views/partials/status-badge.ejs
  var STATUS_BADGE_CLASS = {
    success: 'badge-success',
    failed: 'badge-error',
    interrupted: 'badge-error',
    running: 'badge-info',
    queued: 'badge-info',
    destroyed: 'badge-ghost',
    pending: 'badge-ghost',
  };

  function badgeClassFor(status) {
    return 'badge rounded-sm ' + (STATUS_BADGE_CLASS[status] || 'badge-ghost');
  }

  // Keep in sync with the stepDotClass map in deployments/show.ejs
  var STEP_DOT_CLASS = {
    success: 'step-success',
    failed: 'step-error',
    interrupted: 'step-error',
    running: 'step-info',
    queued: 'step-info',
  };

  // Keep in sync with the stepAnimClass map in deployments/show.ejs
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

  var logEl = document.getElementById('log');
  var source = new EventSource('/deployments/' + deploymentId + '/events');

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
    } else if (msg.type === 'deployment') {
      var deploymentStatusEl = document.getElementById('deployment-status');
      if (deploymentStatusEl) {
        deploymentStatusEl.textContent = msg.status;
        deploymentStatusEl.className = badgeClassFor(msg.status);
      }
      var progressTrackEl = document.getElementById('steps-progress-track');
      if (progressTrackEl) {
        progressTrackEl.classList.toggle('hidden', !['running', 'queued'].includes(msg.status));
      }
      var progressBarEl = document.getElementById('steps-progress-bar');
      if (progressBarEl) {
        progressBarEl.classList.toggle('steps-progress-active', msg.status === 'running');
      }
      if (msg.status === 'success' || msg.status === 'failed' || msg.status === 'destroyed') {
        source.close();
        location.reload();
      }
    }
  };
})();

