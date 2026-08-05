#!/usr/bin/env bash
# host/comment-stop-write-checklist.sh — Stage 10 comment cutover checklist (plan §8.5 §3).
# This script does NOT mutate Typecho by itself. It prints and verifies the
# ordered gates an operator must complete before enabling Waline writes.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
ORIGIN="${ORIGIN:-https://www.andy-y.cn}"

echo "== Stage 10 comment stop-write checklist =="
echo "1. Confirm state/comment-write-mode is disabled"
MODE="$(tr -d '\r\n' <"$STATE_DIR/comment-write-mode" 2>/dev/null || echo missing)"
echo "   current: $MODE"
[[ "$MODE" == "disabled" ]] || {
  echo "FAIL: comment-write-mode must be disabled before stop-write window" >&2
  exit 64
}

echo "2. Close Typecho comment writes (CMS plugin/options) — manual"
echo "3. Wait for in-flight Typecho comment requests to drain — manual"
echo "4. Run final idempotent migrate against production Waline MySQL — manual"
echo "   (scripts/migrate-comments.js currently memory-only; live backend is a Stage 10 VPS step)"
echo "5. Diff Typecho vs Waline counts/parent graph must be 0 — manual"
echo "6. Direct POST to /api/comment must be 403 while disabled"

set +e
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$ORIGIN/api/comment" \
  -H 'Content-Type: application/json' \
  --data '{"comment":"stage10-probe","nick":"probe","mail":"probe@example.com","url":"","path":"/"}' \
  --max-time 15)"
set -e
echo "   POST $ORIGIN/api/comment -> HTTP $CODE"
if [[ "$CODE" != "403" && "$CODE" != "000" ]]; then
  echo "WARN: expected 403 (or unreachable 000 pre-cutover); got $CODE" >&2
fi

echo "7. After reconcile=0: transition-deploy-state.sh comment-write-mode enabled"
echo "8. Rebuild+switch a release that embeds commentWriteMode=enabled"
echo "9. Verify only open commentKeys accept POST; closed keys stay 403"
echo "DONE checklist printed. Do not enable writes until steps 2–5 are evidenced."
