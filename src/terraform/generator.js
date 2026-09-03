const fs = require('fs');
const path = require('path');
const config = require('../config');

function gatewayFor(ip) {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
}

function renderProviderTf() {
  return `terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.71.0"
    }
  }
}

variable "pm_api_token_secret" {
  type      = string
  sensitive = true
}

provider "proxmox" {
  endpoint = "${config.proxmox.apiUrl}"
  username = "${config.proxmox.tokenId}"
  password = var.pm_api_token_secret
  insecure = true
}
`;
}

function renderMainTf(deployment, nodes, role) {
  const vmEntries = nodes
    .map(
      (node) => `    {
      name      = "${node.name}"
      cores     = ${role.default_cores}
      memory    = ${role.default_memory}
      disk_size = ${role.default_disk_size}
      static_ip = "${node.ip}/24"
      gateway   = "${gatewayFor(node.ip)}"
      subnet_id = "${node.subnet_id}"
    }`,
    )
    .join(',\n');

  return `variable "ipam_password" {
  type      = string
  sensitive = true
}

locals {
  vms = [
${vmEntries}
  ]
}

module "vms" {
  source = "${config.terraformModulePath}"

  for_each = { for vm in local.vms : vm.name => vm }

  target_node       = "${deployment.target_node}"
  vm_name           = each.value.name
  vm_cores          = each.value.cores
  vm_memory         = each.value.memory
  vm_disk_size      = each.value.disk_size
  vm_network_bridge = "${config.proxmox.networkBridge}"
  vm_static_ip      = each.value.static_ip
  vm_gateway        = each.value.gateway
  vm_datastore      = "${config.proxmox.datastore}"
  template_id       = ${config.proxmox.templateId}

  enable_ipam      = ${config.ipam.enabled}
  ipam_url         = "${config.ipam.url}"
  ipam_app_id      = "${config.ipam.appId}"
  ipam_username    = "${config.ipam.username}"
  ipam_password    = var.ipam_password
  ipam_subnet_id   = each.value.subnet_id
  ipam_description = "VM \${each.value.name} deployed by Forge"
}

output "vm_ips" {
  value = { for k, v in module.vms : k => v.vm_ip }
}
`;
}

function generateWorkdir(deployment, nodes, role) {
  fs.mkdirSync(deployment.workdir_path, { recursive: true });
  fs.writeFileSync(path.join(deployment.workdir_path, 'provider.tf'), renderProviderTf());
  fs.writeFileSync(path.join(deployment.workdir_path, 'main.tf'), renderMainTf(deployment, nodes, role));
}

module.exports = { generateWorkdir, gatewayFor };
