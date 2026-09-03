const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');

module.exports = {
  port: process.env.PORT || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  dataDir,
  maxConcurrentDeployments: parseInt(process.env.MAX_CONCURRENT_DEPLOYMENTS || '3', 10),

  proxmox: {
    apiUrl: process.env.PM_API_URL,
    tokenId: process.env.PM_API_TOKEN_ID,
    tokenSecret: process.env.PM_API_TOKEN_SECRET,
    targetNode: process.env.PROXMOX_TARGET_NODE || 'proxmox',
    networkBridge: process.env.PROXMOX_NETWORK_BRIDGE || 'vmbr0',
    datastore: process.env.PROXMOX_DATASTORE || 'local-lvm',
    templateId: parseInt(process.env.PROXMOX_TEMPLATE_ID || '9200', 10),
  },

  ipam: {
    enabled: (process.env.IPAM_ENABLE ?? 'true') === 'true',
    url: process.env.IPAM_URL || 'http://10.4.5.66',
    appId: process.env.IPAM_APP_ID || 'terraform',
    username: process.env.IPAM_USERNAME || 'admin',
    password: process.env.IPAM_PASSWORD,
    subnetId: process.env.IPAM_SUBNET_ID || '7',
  },

  terraformModulePath: process.env.TF_MODULE_PATH || path.join(__dirname, '../terraform/modules/proxmox-vm'),
};
