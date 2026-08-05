#!/usr/bin/env bash
# host/alert-on-failure.sh — OnFailure helper for blog-rebuild / edge-pending.
# Reads durable markers; never invents a healthy status.
set -Eeuo pipefail

REASON="${1:-unknown}"
WWW_ROOT="${WWW_ROOT:-/var/www/andy-y.cn}"
RUNTIME_DIR="${RUNTIME_DIR:-/var/www/andy-blog/runtime/build}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
COMPOSE_DIR="${COMPOSE_DIR:-/var/www/andy-blog}"

payload="reason=$REASON"
if [[ -f "$RUNTIME_DIR/last-failure.json" ]]; then
  payload+=$'\n'"last-failure=$(cat "$RUNTIME_DIR/last-failure.json")"
fi
if [[ -f "$STATE_DIR/edge-status" ]]; then
  payload+=$'\n'"edge-status=$(cat "$STATE_DIR/edge-status")"
fi

exec "$COMPOSE_DIR/host/alert-notify.sh" "andy-blog: $REASON" "$payload"
