#!/bin/sh
set -eu
# Upstream Waline listens on 8361; policy proxy publishes 8360.
export PORT=8361
if [ -f /waline/node_modules/@waline/vercel/package.json ] || [ -f /waline/package.json ]; then
  (cd /waline && node node_modules/@waline/vercel/vanilla.js >/tmp/waline.log 2>&1) &
else
  echo "waline upstream package missing; policy proxy only" >&2
fi
export PORT=8360
exec node /app/server.js
