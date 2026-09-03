const config = require('../config');

// Minimal in-process job queue: limits how many deployments run at once.
// Steps within a single deployment already run sequentially inside its job function.
class JobQueue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.active = 0;
    this.pending = [];
  }

  add(jobFn) {
    this.pending.push(jobFn);
    this._runNext();
  }

  _runNext() {
    if (this.active >= this.concurrency || this.pending.length === 0) return;
    const jobFn = this.pending.shift();
    this.active += 1;
    Promise.resolve()
      .then(jobFn)
      .catch((err) => console.error('Deployment job failed:', err))
      .finally(() => {
        this.active -= 1;
        this._runNext();
      });
  }
}

module.exports = new JobQueue(config.maxConcurrentDeployments);
