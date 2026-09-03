variable "target_node" {}
variable "vm_name" {}
variable "vm_cores" { default = 2 }
variable "vm_memory" { default = 4096 }
variable "vm_disk_size" { default = 20 }
variable "vm_network_bridge" { default = "vmbr0" }
variable "vm_static_ip" {}
variable "vm_gateway" {}
variable "vm_datastore" { default = "local-lvm" }
variable "template_id" {}

# Optional IPAM integration variables
variable "enable_ipam" {
  description = "Enable IPAM integration"
  type        = bool
  default     = false
}

variable "ipam_url" {
  description = "phpIPAM server URL"
  type        = string
  default     = ""
}

variable "ipam_app_id" {
  description = "phpIPAM application ID"
  type        = string
  default     = ""
}

variable "ipam_username" {
  description = "phpIPAM username"
  type        = string
  default     = ""
}

variable "ipam_password" {
  description = "phpIPAM password"
  type        = string
  default     = ""
  sensitive   = true
}

variable "ipam_subnet_id" {
  description = "phpIPAM subnet ID where the IP should be registered"
  type        = string
  default     = ""
}

variable "ipam_description" {
  description = "Description for the IP address in IPAM"
  type        = string
  default     = "VM deployed by Terraform"
}
