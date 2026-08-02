#!/usr/bin/env bash
# host/blog-rebuild.sh — consume durable pending/dirty spool and build a release.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
COMPOSE_DIR="${COMPOSE_DIR:?set compose project directory}"
RUNTIME="${RUNTIME_DIR:-$COMPOSE_DIR/runtime/build}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
mkdir -p "$STATE_DIR" "$RUNTIME/spool" "$WWW_ROOT/releases"

REDIRECT_STATUS="$(cat "$STATE_DIR/redirect-status" 2>/dev/null || echo 302)"
COMMENT_WRITE_MODE="$(cat "$STATE_DIR/comment-write-mode" 2>/dev/null || echo disabled)"
case "$REDIRECT_STATUS" in 302|301) ;; *) echo "bad redirect-status" >&2; exit 64 ;; esac
case "$COMMENT_WRITE_MODE" in disabled|enabled) ;; *) echo "bad comment-write-mode" >&2; exit 64 ;; esac

# Trailing debounce: if pending is younger than 60s, wait out the window.
if [[ -f "$RUNTIME/pending" ]]; then
  age=$(( $(date +%s) - $(stat -c %Y "$RUNTIME/pending") ))
  if (( age < 60 )); then
    sleep $((60 - age))
  fi
fi

cd "$COMPOSE_DIR"

# Capture cutoff for this logical job (retries reuse the same descriptor).
JOB_FILE="$RUNTIME/current-job.json"
if [[ ! -f "$JOB_FILE" ]]; then
  EPOCH="$(docker compose run --rm --no-TTY --quiet-pull builder node /app/scripts/read-db-epoch.js)"
  [[ "$EPOCH" =~ ^[0-9]{10}$ ]] || { echo "bad epoch from builder" >&2; exit 65; }
  printf '%s\n' "{\"snapshotEpoch\":\"$EPOCH\",\"redirectStatus\":$REDIRECT_STATUS,\"commentWriteMode\":\"$COMMENT_WRITE_MODE\",\"createdAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    >"$JOB_FILE"
fi

SNAPSHOT_EPOCH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["snapshotEpoch"])' "$JOB_FILE")"

set +e
RELEASE_ID="$(
  docker compose run --rm --no-TTY --quiet-pull \
    -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" \
    -e "REDIRECT_STATUS=$REDIRECT_STATUS" \
    -e "COMMENT_WRITE_MODE=$COMMENT_WRITE_MODE" \
    -e "WWW_ROOT=/var/www/andy-y.cn" \
    builder /app/scripts/build-release.sh
)"
rc=$?
set -e
if [[ $rc -ne 0 ]]; then
  echo "build failed rc=$rc" >&2
  printf '%s\n' "{\"failedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"rc\":$rc}" >"$RUNTIME/last-failure.json"
  exit $rc
fi

RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | tail -n1)"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "builder returned bad id: $RELEASE_ID" >&2
  exit 66
}

"$COMPOSE_DIR/host/switch-release.sh" "$RELEASE_ID"

# Capture previous success id BEFORE overwriting — baidu-push diffs against it.
PREV_SUCCESS="$(cat "$STATE_DIR/last-success-release" 2>/dev/null || true)"

# Persist success + clear job descriptor.
printf '%s\n' "$RELEASE_ID" >"$STATE_DIR/last-success-release"
rm -f "$JOB_FILE" "$RUNTIME/last-failure.json"

# Edge purge (persistent job; failures mark edge-pending).
if [[ -x "$COMPOSE_DIR/host/cdn-purge.sh" ]]; then
  "$COMPOSE_DIR/host/cdn-purge.sh" "$RELEASE_ID" || {
    echo "edge-pending" >"$STATE_DIR/edge-status"
    exit 71
  }
  echo "ok" >"$STATE_DIR/edge-status"
fi

# Baidu incremental push for newly added post URLs only.
if [[ -x "$COMPOSE_DIR/host/baidu-push.sh" ]]; then
  "$COMPOSE_DIR/host/baidu-push.sh" "$RELEASE_ID" "$PREV_SUCCESS" || true
fi

# If dirty was set mid-build, re-arm pending for another cycle.
if [[ -f "$RUNTIME/dirty" ]]; then
  mv -f "$RUNTIME/dirty" "$RUNTIME/pending"
  # Drop current-job so the next cycle captures a fresh cutoff.
  rm -f "$JOB_FILE"
fi

echo "rebuild complete: $RELEASE_ID"
