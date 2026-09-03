terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.71.0"
    }
  }
}


resource "proxmox_virtual_environment_vm" "vm" {
  node_name   = var.target_node
  name        = var.vm_name
  description = "Managed by Terraform."
  tags        = ["terraform"]

  started     = true
  on_boot     = true

  agent {
    enabled = true
  }

  clone {
    node_name = var.target_node
    vm_id = var.template_id
  }

  operating_system {
    type = "l26"
  }

  cpu {
    cores = var.vm_cores
  }

  memory {
    dedicated = var.vm_memory
  }

  disk {
    datastore_id = var.vm_datastore
    discard      = "on"
    interface    = "scsi0"
    size         = var.vm_disk_size
  }

  vga {
    type = "serial0"
  }

  network_device {
    bridge = var.vm_network_bridge
    enabled = "true"
  }

  initialization {
    datastore_id = var.vm_datastore

    ip_config {
      ipv4 {
        address = var.vm_static_ip
        gateway = var.vm_gateway
      }
    }

    dns {
      servers = ["4.4.4.4", "8.8.8.8"]
    }
  }
}

# Optional IPAM integration
resource "null_resource" "ipam_register" {
  count = var.enable_ipam ? 1 : 0
  depends_on = [proxmox_virtual_environment_vm.vm]
  
  triggers = {
    vm_id         = proxmox_virtual_environment_vm.vm.id
    ip_address    = var.vm_static_ip
    hostname      = var.vm_name
    ipam_url      = var.ipam_url
    app_id        = var.ipam_app_id
    subnet_id     = var.ipam_subnet_id
    ipam_username = var.ipam_username
    ipam_password = var.ipam_password
  }
  
  # Register IP on creation
  provisioner "local-exec" {
    command = <<-EOT
      set -e
      echo "IPAM: Starting IP registration for ${var.vm_static_ip}"
      
      # Get auth token
      echo "IPAM: Authenticating with ${var.ipam_url}"
      AUTH_RESPONSE=$(curl -s -u "${var.ipam_username}:${var.ipam_password}" -X POST "${var.ipam_url}/api/${var.ipam_app_id}/user/")
      TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
      
      if [ -z "$TOKEN" ]; then
        echo "IPAM: Failed to get authentication token"
        echo "IPAM: Auth response: $AUTH_RESPONSE"
        exit 1
      fi
      
      echo "IPAM: Got authentication token"
      
      # Register IP
      IP_ONLY=$(echo "${var.vm_static_ip}" | cut -d'/' -f1)
      echo "IPAM: Registering IP $IP_ONLY with hostname ${var.vm_name}"
      
      REGISTER_RESULT=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "token: $TOKEN" \
        -d '{"subnetId":"${var.ipam_subnet_id}","ip":"'$IP_ONLY'","hostname":"${var.vm_name}","description":"${var.ipam_description}","note":"Terraform managed"}' \
        "${var.ipam_url}/api/${var.ipam_app_id}/addresses/")
      
      echo "IPAM: Register result: $REGISTER_RESULT"
      
      if echo "$REGISTER_RESULT" | grep -q '"success":true'; then
        echo "IPAM: Successfully registered IP $IP_ONLY in phpIPAM"
      elif echo "$REGISTER_RESULT" | grep -q "already exists"; then
        echo "IPAM: IP $IP_ONLY already exists in phpIPAM - this is OK"
      else
        echo "IPAM: Failed to register IP $IP_ONLY"
        echo "IPAM: Register response: $REGISTER_RESULT"
        exit 1
      fi
      
      echo "IPAM: IP registration completed"
    EOT
  }
  
  # Deregister IP on destruction
  provisioner "local-exec" {
    when = destroy
    command = <<-EOT
      set -e
      echo "IPAM: Starting IP deregistration for ${self.triggers.ip_address}"
      
      # Get auth token
      echo "IPAM: Authenticating with ${self.triggers.ipam_url}"
      AUTH_RESPONSE=$(curl -s -u "${self.triggers.ipam_username}:${self.triggers.ipam_password}" -X POST "${self.triggers.ipam_url}/api/${self.triggers.app_id}/user/")
      TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
      
      if [ -z "$TOKEN" ]; then
        echo "IPAM: Failed to get authentication token"
        echo "IPAM: Auth response: $AUTH_RESPONSE"
        exit 1
      fi
      
      echo "IPAM: Got authentication token"
      
      # Find and delete IP
      IP_ONLY=$(echo "${self.triggers.ip_address}" | cut -d'/' -f1)
      echo "IPAM: Searching for IP $IP_ONLY"
      
      SEARCH_RESULT=$(curl -s -H "token: $TOKEN" "${self.triggers.ipam_url}/api/${self.triggers.app_id}/addresses/search/$IP_ONLY/")
      echo "IPAM: Search result: $SEARCH_RESULT"
      
      ADDRESS_ID=$(echo "$SEARCH_RESULT" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
      
      if [ -n "$ADDRESS_ID" ]; then
        echo "IPAM: Found address ID: $ADDRESS_ID, deleting..."
        DELETE_RESULT=$(curl -s -X DELETE -H "token: $TOKEN" "${self.triggers.ipam_url}/api/${self.triggers.app_id}/addresses/$ADDRESS_ID/")
        echo "IPAM: Delete result: $DELETE_RESULT"
        
        if echo "$DELETE_RESULT" | grep -q '"success":true'; then
          echo "IPAM: Successfully removed IP $IP_ONLY from phpIPAM"
        else
          echo "IPAM: Failed to remove IP $IP_ONLY"
          echo "IPAM: Delete response: $DELETE_RESULT"
        fi
      else
        echo "IPAM: No address ID found for IP $IP_ONLY - may already be deleted"
      fi
      
      echo "IPAM: IP deregistration completed"
    EOT
  }
}
