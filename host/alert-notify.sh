#!/usr/bin/env bash
# host/alert-notify.sh — send a Stage 9 alert. Never pretend success without a webhook.
set -Eeuo pipefail

SUBJECT="${1:?subject}"
BODY="${2:-}"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[alert] $ts $SUBJECT" >&2
if [[ -n "$BODY" ]]; then
  echo "$BODY" >&2
fi

if [[ -z "${ALERT_WEBHOOK_URL:-}" ]]; then
  echo "alert not-configured: ALERT_WEBHOOK_URL unset" >&2
  exit 71
fi

# Placeholder until a real notifier is wired. Credentials present ≠ delivery ok.
echo "alert webhook not-implemented (refusing to fake ok)" >&2
exit 71
