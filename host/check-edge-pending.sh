#!/usr/bin/env bash
# host/check-edge-pending.sh — periodic edge-pending / cert-expiry check.
# Fail-closed: pending edge or missing cert → alert path (exit 71 if notifier unset).
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:-/var/www/andy-y.cn}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
COMPOSE_DIR="${COMPOSE_DIR:-/var/www/andy-blog}"
CERT_NEW="${CERT_NEW:-/etc/letsencrypt/live/new.andy-y.cn/fullchain.pem}"
CERT_WWW="${CERT_WWW:-/etc/letsencrypt/live/andy-y.cn/fullchain.pem}"

status=0

if [[ -f "$STATE_DIR/edge-status" ]] && grep -qx 'edge-pending' "$STATE_DIR/edge-status"; then
  echo "edge-pending marker present" >&2
  "$COMPOSE_DIR/host/alert-on-failure.sh" "edge-pending" || status=$?
fi

check_cert() {
  local path="$1" label="$2"
  if [[ ! -f "$path" ]]; then
    echo "cert missing: $label ($path)" >&2
    "$COMPOSE_DIR/host/alert-on-failure.sh" "cert-missing:$label" || status=$?
    return
  fi
  # Warn if openssl can see expiry within 21 days (host must have openssl).
  if command -v openssl >/dev/null 2>&1; then
    local end
    end="$(openssl x509 -enddate -noout -in "$path" 2>/dev/null | cut -d= -f2 || true)"
    if [[ -n "$end" ]]; then
      local end_epoch now_epoch
      end_epoch="$(date -d "$end" +%s 2>/dev/null || date -j -f '%b %d %T %Y %Z' "$end" +%s 2>/dev/null || echo 0)"
      now_epoch="$(date +%s)"
      if [[ "$end_epoch" -gt 0 && $((end_epoch - now_epoch)) -lt $((21 * 86400)) ]]; then
        echo "cert expiring soon: $label ($end)" >&2
        "$COMPOSE_DIR/host/alert-on-failure.sh" "cert-expiring:$label" || status=$?
      fi
    fi
  fi
}

check_cert "$CERT_WWW" "www"
# new cert is optional until staging is enabled; only alert if staging-loader is mounted.
if [[ -f "$COMPOSE_DIR/nginx/staging-loader.conf" ]] && docker compose -f "$COMPOSE_DIR/compose.yml" -f "$COMPOSE_DIR/compose.staging.yml" ps nginx 2>/dev/null | grep -q nginx; then
  check_cert "$CERT_NEW" "new"
fi

exit "$status"
