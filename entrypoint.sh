#!/bin/sh
set -e

mkdir -p "$DATA_DIR"
chown -R forge:forge "$DATA_DIR"

exec gosu forge node src/server.js
