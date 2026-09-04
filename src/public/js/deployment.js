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
    return 'badge rounded-none ' + (STATUS_BADGE_CLASS[status] || 'badge-ghost');
  }

  var logEl = document.getElementById('log');
  var source = new EventSource('/deployments/' + deploymentId + '/events');

  source.onmessage = function (event) {
    var msg = JSON.parse(event.data);

    if (msg.type === 'log') {
      logEl.textContent += msg.line + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    } else if (msg.type === 'step') {
      var stepStatusEl = document.querySelector('[data-step="' + msg.seq + '"] .status-badge');
      if (stepStatusEl) {
        stepStatusEl.textContent = msg.status;
        stepStatusEl.className = 'status-badge ' + badgeClassFor(msg.status);
      }
    } else if (msg.type === 'deployment') {
      var deploymentStatusEl = document.getElementById('deployment-status');
      if (deploymentStatusEl) {
        deploymentStatusEl.textContent = msg.status;
        deploymentStatusEl.className = badgeClassFor(msg.status);
      }
      if (msg.status === 'success' || msg.status === 'failed' || msg.status === 'destroyed') {
        source.close();
        location.reload();
      }
    }
  };
})();
