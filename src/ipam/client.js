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

module.exports = { getToken, firstFreeIp };
