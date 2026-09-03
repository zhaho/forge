const { EventEmitter } = require('events');

const emitters = new Map();

function getEmitter(deploymentId) {
  const key = String(deploymentId);
  if (!emitters.has(key)) emitters.set(key, new EventEmitter());
  return emitters.get(key);
}

module.exports = { getEmitter };
