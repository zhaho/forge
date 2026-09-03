(function () {
  var deploymentId = window.FORGE_DEPLOYMENT_ID;
  if (!deploymentId) return;

  var logEl = document.getElementById('log');
  var source = new EventSource('/deployments/' + deploymentId + '/events');

  source.onmessage = function (event) {
    var msg = JSON.parse(event.data);

    if (msg.type === 'log') {
      logEl.textContent += msg.line + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    } else if (msg.type === 'step') {
      var stepStatusEl = document.querySelector('[data-step="' + msg.seq + '"] .status');
      if (stepStatusEl) {
        stepStatusEl.textContent = msg.status;
        stepStatusEl.className = 'status status-' + msg.status;
      }
    } else if (msg.type === 'deployment') {
      var deploymentStatusEl = document.getElementById('deployment-status');
      if (deploymentStatusEl) deploymentStatusEl.textContent = msg.status;
      if (msg.status === 'success' || msg.status === 'failed') source.close();
    }
  };
})();
