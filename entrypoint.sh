#!/bin/sh
set -e

mkdir -p "$DATA_DIR"
chown -R forge:forge "$DATA_DIR"

# The mounted key keeps the host file's ownership/mode, which the forge user
# usually can't read - copy it to a forge-owned file with the right perms.
if [ -f /run/secrets/id_rsa ]; then
  mkdir -p /home/forge/.ssh
  cp /run/secrets/id_rsa /home/forge/.ssh/id_rsa
  chmod 600 /home/forge/.ssh/id_rsa
  chown forge:forge /home/forge/.ssh/id_rsa
fi

exec gosu forge node src/server.js
