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
PROGRESS_JS="$COMPOSE_DIR/scripts/rebuild-progress.js"
PROGRESS_PHASE="queued"
PHASE_FILE="$RUNTIME/progress.phase"
RETRY_FILE="$RUNTIME/retry-count"
MAX_RETRIES="${ANDY_BLOG_REBUILD_MAX_RETRIES:-3}"
[[ "$MAX_RETRIES" =~ ^[0-9]+$ ]] && (( MAX_RETRIES >= 1 )) || MAX_RETRIES=3

read_int_file() {
  local n=0
  if [[ -f "$1" ]]; then
    n=$(tr -d '[:space:]' <"$1" || true)
  fi
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  printf '%s' "$n"
}

progress_emit() {
  [[ -f "$PROGRESS_JS" ]] || return 0
  node "$PROGRESS_JS" --runtime "$RUNTIME" --builder "$ANDY_BLOG_BUILDER" \
    --retry-max "$MAX_RETRIES" --retry-count "$(read_int_file "$RETRY_FILE")" "$@" >/dev/null \
    || echo "warning: rebuild progress update failed" >&2
}

ssh_user_host() {
  local spec="$1"
  if [[ "$spec" == *@* ]]; then
    printf '%s %s' "${spec%%@*}" "${spec#*@}"
  else
    printf 'root %s' "$spec"
  fi
}

offbox_prepare_ssh() {
  [[ -n "${OFFBOX_SSH_TARGET:-}" && -n "${OFFBOX_SSH_KEY:-}" && -f "${OFFBOX_SSH_KEY}" ]] || return 1
  OFFBOX_SSH_CFG="$RUNTIME/ssh-offbox.config"
  local dest_user dest_host jump_user jump_host
  read -r dest_user dest_host <<<"$(ssh_user_host "$OFFBOX_SSH_TARGET")"
  umask 077
  {
    printf 'Host offbox-builder\n'
    printf '  HostName %s\n' "$dest_host"
    printf '  User %s\n' "$dest_user"
    printf '  IdentityFile %s\n' "$OFFBOX_SSH_KEY"
    printf '  IdentitiesOnly yes\n'
    printf '  BatchMode yes\n'
    printf '  StrictHostKeyChecking yes\n'
    printf '  ConnectTimeout 60\n'
    printf '  ServerAliveInterval 15\n'
    printf '  ServerAliveCountMax 8\n'
    if [[ -n "${OFFBOX_SSH_JUMP:-}" ]]; then
      [[ -n "${OFFBOX_SSH_JUMP_KEY:-}" && -f "${OFFBOX_SSH_JUMP_KEY}" ]] || {
        echo "offbox jump ssh key missing" >&2
        return 65
      }
      read -r jump_user jump_host <<<"$(ssh_user_host "$OFFBOX_SSH_JUMP")"
      printf '  ProxyJump offbox-jump\n'
      printf '\nHost offbox-jump\n'
      printf '  HostName %s\n' "$jump_host"
      printf '  User %s\n' "$jump_user"
      printf '  IdentityFile %s\n' "$OFFBOX_SSH_JUMP_KEY"
      printf '  IdentitiesOnly yes\n'
      printf '  BatchMode yes\n'
      printf '  StrictHostKeyChecking yes\n'
      printf '  ConnectTimeout 20\n'
    fi
  } >"$OFFBOX_SSH_CFG"
}

offbox_ssh() {
  offbox_prepare_ssh
  ssh -F "$OFFBOX_SSH_CFG" offbox-builder "$@"
}

offbox_scp() {
  offbox_prepare_ssh
  scp -F "$OFFBOX_SSH_CFG" "$@"
}

assert_safe_tar_archive() {
  local archive="$1"
  if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "unsafe archive path in $archive" >&2
    exit 64
  fi
}

assert_safe_extract_tree() {
  local root="$1"
  if find "$root" ! -type f ! -type d -print -quit | grep -q .; then
    echo "archive contains special files under $root" >&2
    exit 64
  fi
}

progress_push() {
  [[ "${OFFBOX_PROGRESS_LOCAL:-}" == "1" ]] && return 0
  [[ -n "${OFFBOX_SSH_TARGET:-}" && -n "${OFFBOX_SSH_KEY:-}" && -f "${OFFBOX_SSH_KEY}" ]] || return 0
  declare -F offbox_ssh >/dev/null || return 0
  local root="${OFFBOX_ROOT:-/opt/andy-blog-offbox}"
  [[ -f "$RUNTIME/progress.json" ]] || return 0
  offbox_ssh "umask 027; mkdir -p '$root/runtime'" || {
    echo "warning: offbox progress push failed" >&2
    return 0
  }
  local scp_files=("$RUNTIME/progress.json")
  if [[ -f "$RUNTIME/progress.log" ]]; then
    scp_files+=("$RUNTIME/progress.log")
  fi
  if [[ -f "$RUNTIME/history.jsonl" ]]; then
    scp_files+=("$RUNTIME/history.jsonl")
  fi
  if [[ -f "$RUNTIME/last-failure.json" ]]; then
    scp_files+=("$RUNTIME/last-failure.json")
  fi
  offbox_scp "${scp_files[@]}" "offbox-builder:$root/runtime/" \
    || echo "warning: offbox progress push failed" >&2
}

progress_phase() {
  PROGRESS_PHASE="$1"
  printf '%s\n' "$PROGRESS_PHASE" >"$PHASE_FILE"
  progress_emit --status running --phase "$PROGRESS_PHASE"
  progress_push
}

progress_pipe() {
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line" >&2
    if [[ "$line" == PROGRESS\ * ]]; then
      progress_phase "${line#PROGRESS }"
    else
      printf '%s\n' "$line" >>"$RUNTIME/progress.log"
    fi
  done
}

write_failure() {
  local rc="${1:-1}"
  local n
  n=$(read_int_file "$RETRY_FILE")
  n=$((n + 1))
  printf '%s\n' "$n" >"$RETRY_FILE"
  if [[ -f "$PHASE_FILE" ]]; then
    PROGRESS_PHASE="$(tr -d '\r\n' <"$PHASE_FILE" || true)"
  fi
  [[ -n "$PROGRESS_PHASE" ]] || PROGRESS_PHASE="unknown"
  printf '%s\n' "{\"failedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"rc\":$rc,\"phase\":\"${PROGRESS_PHASE}\"}" \
    >"$RUNTIME/last-failure.json"
  if (( n >= MAX_RETRIES )); then
    progress_emit --status failed --phase "$PROGRESS_PHASE" --error "rebuild exited $rc" --retry-exhausted
  else
    progress_emit --status failed --phase "$PROGRESS_PHASE" --error "rebuild exited $rc"
  fi
  progress_push
}

rearm() {
  local n
  n=$(read_int_file "$RETRY_FILE")
  if (( n >= MAX_RETRIES )); then
    echo "rebuild retries exhausted ($n/$MAX_RETRIES); leaving queue idle" >&2
    return 0
  fi
  printf '%s\n' "retry" >"$RUNTIME/pending"
  echo "rebuild will retry ($n/$MAX_RETRIES)" >&2
}

consume_pending() {
  local kind=""
  if [[ -f "$RUNTIME/pending" ]]; then
    kind="$(head -c 16 "$RUNTIME/pending" | tr -d '\r\n' || true)"
    rm -f "$RUNTIME/pending"
  fi
  if [[ "$kind" != "retry" ]]; then
    rm -f "$RETRY_FILE"
  fi
}
trap 'rc=$?; if [[ $rc -ne 0 ]]; then write_failure "$rc"; rearm; fi' EXIT

REDIRECT_STATUS="$(cat "$STATE_DIR/redirect-status")"
COMMENT_WRITE_MODE="$(cat "$STATE_DIR/comment-write-mode")"
case "$REDIRECT_STATUS" in 302|301) ;; *) echo "automatic rebuild requires redirect-status=302|301" >&2; exit 68; esac
[[ "$COMMENT_WRITE_MODE" == "enabled" ]] || { echo "automatic rebuild expects enabled comments" >&2; exit 68; }

if [[ -f "$RUNTIME/pending" ]]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$RUNTIME/pending") ))
  if (( AGE < 30 )); then sleep $((30 - AGE)); fi
fi
consume_pending

cd "$COMPOSE_DIR"
if [[ ! -f "$JOB_FILE" ]]; then
  EPOCH="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY builder node /app/scripts/read-db-epoch.js </dev/null)"
  [[ "$EPOCH" =~ ^[0-9]{10}$ ]] || exit 65
  printf '%s\n' "{\"snapshotEpoch\":\"$EPOCH\",\"redirectStatus\":$REDIRECT_STATUS,\"commentWriteMode\":\"enabled\",\"createdAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >"$JOB_FILE"
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
  progress_phase astro
  set +e
  RELEASE_ID="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY \
    -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" -e "REDIRECT_STATUS=$REDIRECT_STATUS" -e COMMENT_WRITE_MODE=enabled \
    -e WWW_ROOT=/var/www/andy-y.cn builder bash /app/scripts/build-release.sh </dev/null 2> >(progress_pipe))"
  RC=$?
  set -e
  [[ $RC -eq 0 ]] || exit "$RC"
  RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | grep -E '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$' | tail -n1)"
}

build_via_offbox() {
  : "${OFFBOX_SSH_TARGET:?set OFFBOX_SSH_TARGET in $OFFBOX_ENV}"
  : "${OFFBOX_SSH_KEY:?set OFFBOX_SSH_KEY in $OFFBOX_ENV}"
  OFFBOX_ROOT="${OFFBOX_ROOT:-/opt/andy-blog-offbox}"
  OFFBOX_WORK="${OFFBOX_WORK:-$OFFBOX_ROOT/work}"
  command -v rsync >/dev/null || { echo "rsync is required for offbox builds" >&2; exit 65; }
  test -f "$OFFBOX_SSH_KEY" || { echo "offbox ssh key missing" >&2; exit 65; }
  if [[ -n "${OFFBOX_SSH_JUMP:-}" ]]; then
    : "${OFFBOX_SSH_JUMP_KEY:?set OFFBOX_SSH_JUMP_KEY when OFFBOX_SSH_JUMP is set}"
    test -f "$OFFBOX_SSH_JUMP_KEY" || { echo "offbox jump ssh key missing" >&2; exit 65; }
  fi
  test -f "$COMPOSE_DIR/host/offbox-remote-build.sh" || { echo "offbox-remote-build.sh missing from control tree" >&2; exit 65; }
  test -f "$COMPOSE_DIR/scripts/export-typecho-snapshot.js" || { echo "export-typecho-snapshot.js missing from control tree" >&2; exit 65; }
  offbox_prepare_ssh || exit $?

  if ! offbox_ssh 'printf offbox-ok'; then
    echo "offbox builder unreachable; set ANDY_BLOG_BUILDER=vps-overlay to use in-VPS docker (RAM risk)" >&2
    exit 69
  fi

  SNAPSHOT_JSON="$RUNTIME/snapshot-export.json"
  EXPORT_OVERRIDE="$RUNTIME/compose.export-mem.yml"
  progress_phase snapshot
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

  progress_phase sync
  RSYNC_RSH="ssh -F ${OFFBOX_SSH_CFG}"
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
    --exclude astro/public/beoe \
    "$COMPOSE_DIR/" "offbox-builder:$OFFBOX_WORK/"

  offbox_ssh "umask 027; mkdir -p '$OFFBOX_ROOT/in' '$OFFBOX_ROOT/out' '$OFFBOX_ROOT/runtime' '$OFFBOX_ROOT/www/releases' '$OFFBOX_ROOT/state'"
  offbox_scp "$SNAPSHOT_JSON" "offbox-builder:$OFFBOX_ROOT/in/snapshot.json"
  offbox_ssh "chmod 0600 '$OFFBOX_ROOT/in/snapshot.json'"
  rm -f "$SNAPSHOT_JSON"

  LOCAL_TAR="$RUNTIME/offbox-release.tar.gz"
  rm -f "$LOCAL_TAR"
  progress_phase deps
  set +e
  OFFBOX_PROGRESS_LOCAL=1
  RELEASE_ID="$(
    offbox_ssh "umask 027; SNAPSHOT_EPOCH='$SNAPSHOT_EPOCH' REDIRECT_STATUS='$REDIRECT_STATUS' COMMENT_WRITE_MODE='enabled' OFFBOX_ROOT='$OFFBOX_ROOT' OFFBOX_WORK='$OFFBOX_WORK' FIXTURE_PATH='$OFFBOX_ROOT/in/snapshot.json' bash '$OFFBOX_WORK/host/offbox-remote-build.sh'" 2> >(progress_pipe)
  )"
  RC=$?
  unset OFFBOX_PROGRESS_LOCAL
  set -e
  [[ $RC -eq 0 ]] || exit "$RC"
  RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | grep -E '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$' | tail -n1)"
  [[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 66
  progress_emit --status running --phase package --release-id "$RELEASE_ID"
  progress_push

  offbox_scp "offbox-builder:$OFFBOX_ROOT/out/release.tar.gz" "$LOCAL_TAR"
  test -s "$LOCAL_TAR"
  offbox_ssh "rm -f '$OFFBOX_ROOT/in/snapshot.json' '$OFFBOX_ROOT/out/release.tar.gz'"

  if [[ "$SKIP_SWITCH" == "1" ]]; then
    VERIFY_DIR="$RUNTIME/offbox-verify/$RELEASE_ID"
    rm -rf "$VERIFY_DIR"
    mkdir -p "$VERIFY_DIR"
    assert_safe_tar_archive "$LOCAL_TAR"
    tar -C "$VERIFY_DIR" -xzf "$LOCAL_TAR"
    test -d "$VERIFY_DIR/$RELEASE_ID"
    assert_safe_extract_tree "$VERIFY_DIR/$RELEASE_ID"
    (cd "$VERIFY_DIR/$RELEASE_ID" && sha256sum -c checksums.sha256 >/dev/null)
    rm -rf "$VERIFY_DIR" "$LOCAL_TAR"
    return 0
  fi

  progress_phase package
  assert_safe_tar_archive "$LOCAL_TAR"
  tar -C "$WWW_ROOT/releases" -xzf "$LOCAL_TAR"
  rm -f "$LOCAL_TAR"
  test -d "$WWW_ROOT/releases/$RELEASE_ID"
  assert_safe_extract_tree "$WWW_ROOT/releases/$RELEASE_ID"
  test -f "$WWW_ROOT/releases/$RELEASE_ID/checksums.sha256"
}

write_building
: >"$RUNTIME/progress.log"
progress_emit --status running --phase queued --clear-error
trap 'rc=$?; clear_building; if [[ $rc -ne 0 ]]; then write_failure "$rc"; rearm; fi' EXIT

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
  progress_emit --status success --phase done --release-id "$RELEASE_ID"
  progress_push
  rm -f "$RETRY_FILE" "$PHASE_FILE"
  echo "rebuild dry-run complete: $RELEASE_ID"
  exit 0
fi

progress_phase switch
"$COMPOSE_DIR/host/switch-release-1panel.sh" "$RELEASE_ID"
printf '%s\n' "$RELEASE_ID" >"$STATE_DIR/last-success-release"
if [[ "$ENQUEUE_CDN" == "1" ]]; then
  progress_phase cdn
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
progress_emit --status success --phase done --release-id "$RELEASE_ID" --current "$RELEASE_ID" --clear-error
progress_push
rm -f "$RETRY_FILE" "$PHASE_FILE"
echo "rebuild complete: $RELEASE_ID"
