#!/usr/bin/env bash
# Submit the current immutable release's exact URL plans to Aliyun CDN.
set -Eeuo pipefail
umask 077

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
COMPOSE_DIR="${COMPOSE_DIR:?set absolute COMPOSE_DIR}"
RUNTIME="${CDN_RUNTIME_DIR:?set absolute CDN_RUNTIME_DIR}"
STATE_DIR="${STATE_DIR:?set absolute STATE_DIR}"
PENDING_DIR="$RUNTIME/pending"

[[ "$WWW_ROOT" == /* && "$COMPOSE_DIR" == /* && "$RUNTIME" == /* && "$STATE_DIR" == /* ]] || exit 64
mkdir -p "$PENDING_DIR" "$RUNTIME/submitted" "$RUNTIME/superseded" "$STATE_DIR/aliyun-cdn-jobs"
chmod 0700 "$RUNTIME" "$PENDING_DIR" "$RUNTIME/submitted" "$RUNTIME/superseded" "$STATE_DIR/aliyun-cdn-jobs"
exec 9>"$RUNTIME/.lock"
flock -n 9 || exit 0

write_status() {
  printf '%s\n' "$1" >"$STATE_DIR/aliyun-cdn-status.next"
  mv -T "$STATE_DIR/aliyun-cdn-status.next" "$STATE_DIR/aliyun-cdn-status"
}

CURRENT_RELEASE="$(basename "$(readlink -f "$WWW_ROOT/current")")"
[[ "$CURRENT_RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 72

shopt -s nullglob
for QUEUE_FILE in "$PENDING_DIR"/*; do
  RELEASE_ID="$(basename "$QUEUE_FILE")"
  [[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
    echo "invalid CDN queue entry: $RELEASE_ID" >&2
    exit 72
  }
  if [[ "$RELEASE_ID" != "$CURRENT_RELEASE" ]]; then
    mv -T "$QUEUE_FILE" "$RUNTIME/superseded/$RELEASE_ID"
    continue
  fi

  RELEASE_DIR="$WWW_ROOT/releases/$RELEASE_ID"
  test -f "$RELEASE_DIR/cdn-purge-plan.json"
  test -f "$RELEASE_DIR/cdn-preheat-plan.json"
  test -f "$RELEASE_DIR/checksums.sha256"
  test -f "$COMPOSE_DIR/scripts/run-aliyun-cdn-release.js"
  (cd "$RELEASE_DIR" && sha256sum --check --status checksums.sha256) || {
    echo "release checksum verification failed" >&2
    exit 72
  }

  write_status 'aliyun-running'
  if ! node "$COMPOSE_DIR/scripts/run-aliyun-cdn-release.js" --release-id "$RELEASE_ID"; then
    write_status 'aliyun-failed'
    exit 71
  fi
  mv -T "$QUEUE_FILE" "$RUNTIME/submitted/$RELEASE_ID"
  write_status 'aliyun-submitted'
done
