const config = require('../config');

async function getToken() {
  const auth = Buffer.from(`${config.ipam.username}:${config.ipam.password}`).toString('base64');
  const res = await fetch(`${config.ipam.url}/api/${config.ipam.appId}/user/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  });
  const body = await res.json().catch(() => null);
  const token = body && body.data && body.data.token;
  if (!token) {
    throw new Error(`IPAM authentication failed: ${JSON.stringify(body)}`);
  }
  return token;
}

async function firstFreeIp(subnetId) {
  const token = await getToken();
  const res = await fetch(`${config.ipam.url}/api/${config.ipam.appId}/subnets/${subnetId}/first_free/`, {
    headers: { token },
  });
  const body = await res.json().catch(() => null);
  if (!body || body.success !== true || !body.data) {
    throw new Error(`IPAM first_free failed for subnet ${subnetId}: ${JSON.stringify(body)}`);
  }
  return body.data;
}

// Claims an IP immediately so a subsequent first_free call (e.g. for the next
// node in the same deployment) won't hand out the same address again - IPAM
// only excludes addresses that are actually registered, not just "requested".
async function registerIp(subnetId, ip, hostname, description) {
  const token = await getToken();
  const res = await fetch(`${config.ipam.url}/api/${config.ipam.appId}/addresses/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ subnetId: String(subnetId), ip, hostname, description, note: 'Reserved by Forge' }),
  });
  const body = await res.json().catch(() => null);
  if (body && body.success === true) return body;

  const message = (body && body.message) || '';
  if (/already exists/i.test(message)) {
    const err = new Error(`IP ${ip} was already taken (lost allocation race)`);
    err.alreadyExists = true;
    throw err;
  }
  throw new Error(`IPAM address registration failed for ${ip}: ${JSON.stringify(body)}`);
}

module.exports = { getToken, firstFreeIp, registerIp };
