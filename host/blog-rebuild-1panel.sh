#!/usr/bin/env bash
# Consume Typecho webhook work and build/switch a 1Panel-safe production release.
# Default: snapshot on this VPS, Astro/Playwright on the off-box host.
# Fallback: ANDY_BLOG_BUILDER=vps-overlay (in-VPS docker compose; RAM-heavy).
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
COMPOSE_DIR="${COMPOSE_DIR:?set absolute COMPOSE_DIR}"
RUNTIME="${RUNTIME_DIR:?set absolute RUNTIME_DIR}"
STATE_DIR="${STATE_DIR:?set absolute STATE_DIR}"
CDN_RUNTIME="${CDN_RUNTIME_DIR:-$COMPOSE_DIR/runtime/cdn}"
COMPOSE_FILE="$COMPOSE_DIR/compose.1panel-cms.yml"
JOB_FILE="$RUNTIME/current-job.json"
OFFBOX_ENV="${OFFBOX_ENV_FILE:-/etc/andy-blog/offbox-builder.env}"
mkdir -p "$RUNTIME/spool" "$WWW_ROOT/releases" "$CDN_RUNTIME/pending"

if [[ -f "$OFFBOX_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$OFFBOX_ENV"
  set +a
fi
ANDY_BLOG_BUILDER="${ANDY_BLOG_BUILDER:-offbox}"
ENQUEUE_CDN="${ENQUEUE_CDN:-1}"
SKIP_SWITCH="${SKIP_SWITCH:-0}"

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
  EPOCH="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY builder node /app/scripts/read-db-epoch.js </dev/null)"
  [[ "$EPOCH" =~ ^[0-9]{10}$ ]] || exit 65
  printf '%s\n' "{\"snapshotEpoch\":\"$EPOCH\",\"redirectStatus\":302,\"commentWriteMode\":\"enabled\",\"createdAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >"$JOB_FILE"
fi
SNAPSHOT_EPOCH="$(node -e 'const f=require("fs");process.stdout.write(JSON.parse(f.readFileSync(process.argv[1],"utf8")).snapshotEpoch)' "$JOB_FILE")"

write_building() {
  printf '%s\n' "{\"releaseId\":\"pending\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"builder\":\"$ANDY_BLOG_BUILDER\"}" \
    >"$RUNTIME/building"
}
clear_building() {
  rm -f "$RUNTIME/building"
}

build_via_vps_overlay() {
  set +e
  RELEASE_ID="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY \
    -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" -e REDIRECT_STATUS=302 -e COMMENT_WRITE_MODE=enabled \
    -e WWW_ROOT=/var/www/andy-y.cn builder bash /app/scripts/build-release.sh </dev/null)"
  RC=$?
  set -e
  [[ $RC -eq 0 ]] || exit "$RC"
  RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | tail -n1)"
}

offbox_ssh() {
  ssh -i "$OFFBOX_SSH_KEY" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=yes \
    "$OFFBOX_SSH_TARGET" "$@"
}

build_via_offbox() {
  : "${OFFBOX_SSH_TARGET:?set OFFBOX_SSH_TARGET in $OFFBOX_ENV}"
  : "${OFFBOX_SSH_KEY:?set OFFBOX_SSH_KEY in $OFFBOX_ENV}"
  OFFBOX_ROOT="${OFFBOX_ROOT:-/opt/andy-blog-offbox}"
  OFFBOX_WORK="${OFFBOX_WORK:-$OFFBOX_ROOT/work}"
  command -v rsync >/dev/null || { echo "rsync is required for offbox builds" >&2; exit 65; }
  test -f "$OFFBOX_SSH_KEY" || { echo "offbox ssh key missing" >&2; exit 65; }
  test -f "$COMPOSE_DIR/host/offbox-remote-build.sh" || { echo "offbox-remote-build.sh missing from control tree" >&2; exit 65; }
  test -f "$COMPOSE_DIR/scripts/export-typecho-snapshot.js" || { echo "export-typecho-snapshot.js missing from control tree" >&2; exit 65; }

  if ! offbox_ssh 'printf offbox-ok'; then
    echo "offbox builder unreachable; set ANDY_BLOG_BUILDER=vps-overlay to use in-VPS docker (RAM risk)" >&2
    exit 69
  fi

  SNAPSHOT_JSON="$RUNTIME/snapshot-export.json"
  EXPORT_OVERRIDE="$RUNTIME/compose.export-mem.yml"
  chmod a+r "$COMPOSE_DIR/scripts/export-typecho-snapshot.js"
  printf '%s\n' 'services:' '  builder:' '    mem_limit: 512m' '    memswap_limit: 512m' >"$EXPORT_OVERRIDE"
  set +e
  docker compose -f "$COMPOSE_FILE" -f "$EXPORT_OVERRIDE" run --rm --no-TTY --no-deps \
    -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" \
    -e "EXPORT_SNAPSHOT_JSON=/runtime/build/snapshot-export.json" \
    -e NODE_OPTIONS=--max-old-space-size=256 \
    -v "$COMPOSE_DIR/scripts/export-typecho-snapshot.js:/app/scripts/export-typecho-snapshot.js:ro" \
    builder node /app/scripts/export-typecho-snapshot.js </dev/null
  EXPORT_RC=$?
  set -e
  rm -f "$EXPORT_OVERRIDE"
  [[ $EXPORT_RC -eq 0 ]] || exit "$EXPORT_RC"
  test -s "$SNAPSHOT_JSON"
  chmod 0600 "$SNAPSHOT_JSON"

  RSYNC_RSH="ssh -i ${OFFBOX_SSH_KEY} -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes"
  rsync -az --delete -e "$RSYNC_RSH" \
    --exclude node_modules \
    --exclude dist \
    --exclude .git \
    --exclude runtime \
    --exclude .env \
    --exclude secrets \
    --exclude .planning \
    --exclude .cursor \
    --exclude astro/dist \
    --exclude astro/.cache \
    "$COMPOSE_DIR/" "$OFFBOX_SSH_TARGET:$OFFBOX_WORK/"

  offbox_ssh "umask 027; mkdir -p '$OFFBOX_ROOT/in' '$OFFBOX_ROOT/out' '$OFFBOX_ROOT/runtime' '$OFFBOX_ROOT/www/releases' '$OFFBOX_ROOT/state'"
  scp -i "$OFFBOX_SSH_KEY" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=yes \
    "$SNAPSHOT_JSON" "$OFFBOX_SSH_TARGET:$OFFBOX_ROOT/in/snapshot.json"
  offbox_ssh "chmod 0600 '$OFFBOX_ROOT/in/snapshot.json'"
  rm -f "$SNAPSHOT_JSON"

  LOCAL_TAR="$RUNTIME/offbox-release.tar.gz"
  rm -f "$LOCAL_TAR"
  set +e
  RELEASE_ID="$(
    offbox_ssh "umask 027; SNAPSHOT_EPOCH='$SNAPSHOT_EPOCH' REDIRECT_STATUS='302' COMMENT_WRITE_MODE='enabled' OFFBOX_ROOT='$OFFBOX_ROOT' OFFBOX_WORK='$OFFBOX_WORK' FIXTURE_PATH='$OFFBOX_ROOT/in/snapshot.json' bash '$OFFBOX_WORK/host/offbox-remote-build.sh'"
  )"
  RC=$?
  set -e
  [[ $RC -eq 0 ]] || exit "$RC"
  RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | tail -n1)"
  [[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 66

  scp -i "$OFFBOX_SSH_KEY" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o ConnectTimeout=60 \
    -o StrictHostKeyChecking=yes \
    "$OFFBOX_SSH_TARGET:$OFFBOX_ROOT/out/release.tar.gz" "$LOCAL_TAR"
  test -s "$LOCAL_TAR"
  offbox_ssh "rm -f '$OFFBOX_ROOT/in/snapshot.json' '$OFFBOX_ROOT/out/release.tar.gz'"

  if [[ "$SKIP_SWITCH" == "1" ]]; then
    VERIFY_DIR="$RUNTIME/offbox-verify/$RELEASE_ID"
    rm -rf "$VERIFY_DIR"
    mkdir -p "$VERIFY_DIR"
    tar -C "$VERIFY_DIR" -xzf "$LOCAL_TAR"
    test -d "$VERIFY_DIR/$RELEASE_ID"
    (cd "$VERIFY_DIR/$RELEASE_ID" && sha256sum -c checksums.sha256 >/dev/null)
    rm -rf "$VERIFY_DIR" "$LOCAL_TAR"
    return 0
  fi

  tar -C "$WWW_ROOT/releases" -xzf "$LOCAL_TAR"
  rm -f "$LOCAL_TAR"
  test -d "$WWW_ROOT/releases/$RELEASE_ID"
  test -f "$WWW_ROOT/releases/$RELEASE_ID/checksums.sha256"
}

write_building
trap 'rc=$?; clear_building; if [[ $rc -ne 0 ]]; then rearm; fi' EXIT

if [[ "$ANDY_BLOG_BUILDER" == "vps-overlay" ]]; then
  build_via_vps_overlay
elif [[ "$ANDY_BLOG_BUILDER" == "offbox" ]]; then
  build_via_offbox
else
  echo "unknown ANDY_BLOG_BUILDER=$ANDY_BLOG_BUILDER" >&2
  exit 64
fi
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 66
clear_building

if [[ "$SKIP_SWITCH" == "1" ]]; then
  trap - EXIT
  echo "rebuild dry-run complete: $RELEASE_ID"
  exit 0
fi

"$COMPOSE_DIR/host/switch-release-1panel.sh" "$RELEASE_ID"
printf '%s\n' "$RELEASE_ID" >"$STATE_DIR/last-success-release"
if [[ "$ENQUEUE_CDN" == "1" ]]; then
  CDN_QUEUE_TEMP="$CDN_RUNTIME/.pending-$RELEASE_ID"
  if printf '%s\n' "$RELEASE_ID" >"$CDN_QUEUE_TEMP" \
    && chmod 0600 "$CDN_QUEUE_TEMP" \
    && mv -T "$CDN_QUEUE_TEMP" "$CDN_RUNTIME/pending/$RELEASE_ID"; then
    printf '%s\n' 'aliyun-pending' >"$STATE_DIR/aliyun-cdn-status.next"
    mv -T "$STATE_DIR/aliyun-cdn-status.next" "$STATE_DIR/aliyun-cdn-status"
  else
    echo "warning: release switched but Aliyun CDN enqueue failed for $RELEASE_ID" >&2
  fi
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
