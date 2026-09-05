const path = require('path');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../data'));

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
    // Direct SSH access to the Proxmox host itself (distinct from config.ssh,
    // which targets deployed VMs) - used only for building/destroying images.
    sshHost: process.env.PROXMOX_SSH_HOST,
    sshUser: process.env.PROXMOX_SSH_USER || 'root',
  },

  ipam: {
    enabled: (process.env.IPAM_ENABLE ?? 'true') === 'true',
    url: process.env.IPAM_URL || 'http://10.4.5.66',
    appId: process.env.IPAM_APP_ID || 'terraform',
    username: process.env.IPAM_USERNAME || 'admin',
    password: process.env.IPAM_PASSWORD,
    subnetId: process.env.IPAM_SUBNET_ID || '7',
  },

  ssh: {
    user: process.env.HOST_USER || 'zhaho',
    privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH || '/home/forge/.ssh/id_rsa',
    knownHostsPath: path.join(dataDir, 'ssh_known_hosts'),
  },

  // Cloud-init defaults baked into every image Forge builds, so VMs cloned
  // from them stay reachable the same way as the existing template.
  image: {
    ciUser: process.env.IMAGE_CI_USER || process.env.HOST_USER || 'zhaho',
    ciPassword: process.env.IMAGE_CI_PASSWORD || '',
    ciUpgrade: process.env.IMAGE_CI_UPGRADE || '1',
    ciIpConfig: process.env.IMAGE_CI_IPCONFIG || 'ip=dhcp',
    vmMemory: parseInt(process.env.IMAGE_VM_MEMORY || '2048', 10),
    vmDiskSize: process.env.IMAGE_VM_DISK_SIZE || '20G',
    // Templates get VMIDs from this range upward, kept separate from the
    // lower range Proxmox hands out to regular deployed VMs.
    vmidRangeStart: parseInt(process.env.IMAGE_VMID_RANGE_START || '9000', 10),
  },

  terraformModulePath: process.env.TF_MODULE_PATH || path.join(__dirname, '../terraform/modules/proxmox-vm'),
  ansibleRolesPath: process.env.ANSIBLE_ROLES_PATH || path.join(__dirname, '../ansible/roles'),
  ansiblePlaybooksDir: process.env.ANSIBLE_PLAYBOOKS_DIR || path.join(__dirname, '../ansible/playbooks'),
  ansibleConfigPath: process.env.ANSIBLE_CONFIG || path.join(__dirname, '../ansible/ansible.cfg'),
};
