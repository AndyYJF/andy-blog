#!/usr/bin/env bash
# Consume Typecho webhook work and build/switch a 1Panel-safe production release.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
COMPOSE_DIR="${COMPOSE_DIR:?set absolute COMPOSE_DIR}"
RUNTIME="${RUNTIME_DIR:?set absolute RUNTIME_DIR}"
STATE_DIR="${STATE_DIR:?set absolute STATE_DIR}"
CDN_RUNTIME="${CDN_RUNTIME_DIR:-$COMPOSE_DIR/runtime/cdn}"
COMPOSE_FILE="$COMPOSE_DIR/compose.1panel-cms.yml"
JOB_FILE="$RUNTIME/current-job.json"
mkdir -p "$RUNTIME/spool" "$WWW_ROOT/releases" "$CDN_RUNTIME/pending"

rearm() {
  printf '%s\n' "retry" >"$RUNTIME/pending"
}
trap 'rc=$?; if [[ $rc -ne 0 ]]; then rearm; fi' EXIT

REDIRECT_STATUS="$(cat "$STATE_DIR/redirect-status")"
COMMENT_WRITE_MODE="$(cat "$STATE_DIR/comment-write-mode")"
[[ "$REDIRECT_STATUS" == "302" ]] || { echo "automatic rebuild is locked to 302 during observation" >&2; exit 68; }
[[ "$COMMENT_WRITE_MODE" == "enabled" ]] || { echo "automatic rebuild expects enabled comments" >&2; exit 68; }

if [[ -f "$RUNTIME/pending" ]]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$RUNTIME/pending") ))
  if (( AGE < 30 )); then sleep $((30 - AGE)); fi
fi

cd "$COMPOSE_DIR"
if [[ ! -f "$JOB_FILE" ]]; then
  EPOCH="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY builder node /app/scripts/read-db-epoch.js)"
  [[ "$EPOCH" =~ ^[0-9]{10}$ ]] || exit 65
  printf '%s\n' "{\"snapshotEpoch\":\"$EPOCH\",\"redirectStatus\":302,\"commentWriteMode\":\"enabled\",\"createdAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >"$JOB_FILE"
fi
SNAPSHOT_EPOCH="$(node -e 'const f=require("fs");process.stdout.write(JSON.parse(f.readFileSync(process.argv[1],"utf8")).snapshotEpoch)' "$JOB_FILE")"

set +e
RELEASE_ID="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY \
  -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" -e REDIRECT_STATUS=302 -e COMMENT_WRITE_MODE=enabled \
  -e WWW_ROOT=/var/www/andy-y.cn builder bash /app/scripts/build-release.sh)"
RC=$?
set -e
[[ $RC -eq 0 ]] || exit "$RC"
RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | tail -n1)"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 66

"$COMPOSE_DIR/host/switch-release-1panel.sh" "$RELEASE_ID"
printf '%s\n' "$RELEASE_ID" >"$STATE_DIR/last-success-release"
CDN_QUEUE_TEMP="$CDN_RUNTIME/.pending-$RELEASE_ID"
if printf '%s\n' "$RELEASE_ID" >"$CDN_QUEUE_TEMP" \
  && chmod 0600 "$CDN_QUEUE_TEMP" \
  && mv -T "$CDN_QUEUE_TEMP" "$CDN_RUNTIME/pending/$RELEASE_ID"; then
  printf '%s\n' 'aliyun-pending' >"$STATE_DIR/aliyun-cdn-status.next"
  mv -T "$STATE_DIR/aliyun-cdn-status.next" "$STATE_DIR/aliyun-cdn-status"
else
  echo "warning: release switched but Aliyun CDN enqueue failed for $RELEASE_ID" >&2
fi
mv -f "$JOB_FILE" "$RUNTIME/spool/job-$RELEASE_ID.json"
if [[ -f "$RUNTIME/last-failure.json" ]]; then
  mv -f "$RUNTIME/last-failure.json" "$RUNTIME/spool/last-failure-$RELEASE_ID.json"
fi
if [[ -f "$RUNTIME/dirty" ]]; then
  mv -f "$RUNTIME/dirty" "$RUNTIME/pending"
fi
if ! node "$COMPOSE_DIR/scripts/cleanup-old-releases.js" \
  --deploy-root "$WWW_ROOT" \
  --state-dir "$STATE_DIR" \
  --active-release "$RELEASE_ID" \
  --keep "${RELEASE_RETENTION_COUNT:-3}" \
  --staging-max-age-hours "${STAGING_RETENTION_HOURS:-24}" >&2; then
  echo "warning: release $RELEASE_ID is live, but old release cleanup was refused or failed" >&2
fi
trap - EXIT
echo "rebuild complete: $RELEASE_ID"
