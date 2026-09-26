#!/usr/bin/env bash
# scripts/build-release.sh — builder container or native off-box host.
# stdout: exactly one release ID matching ^[0-9TZ-]+[0-9a-f]{8}$
# stderr/journal: all build logs
set -Eeuo pipefail
umask 027

APP_ROOT="${APP_ROOT:-/app}"
BUILD_LOCK_DIR="${BUILD_LOCK_DIR:-/runtime/build}"

exec 3>&1
exec 1>&2
mkdir -p "$BUILD_LOCK_DIR"
exec 9>"$BUILD_LOCK_DIR/rebuild.lock"
flock 9

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
REDIRECT_STATUS="${REDIRECT_STATUS:?host must pass persisted redirect state}"
case "$REDIRECT_STATUS" in 302|301) ;; *) echo "bad REDIRECT_STATUS=$REDIRECT_STATUS" >&2; exit 64 ;; esac
COMMENT_WRITE_MODE="${COMMENT_WRITE_MODE:?host must pass persisted comment state}"
case "$COMMENT_WRITE_MODE" in disabled|enabled) ;; *) echo "bad COMMENT_WRITE_MODE" >&2; exit 64 ;; esac
SNAPSHOT_EPOCH="${SNAPSHOT_EPOCH:?host must pass persisted job cutoff}"
[[ "$SNAPSHOT_EPOCH" =~ ^[0-9]{10}$ ]] || { echo "bad SNAPSHOT_EPOCH" >&2; exit 64; }
export SNAPSHOT_EPOCH REDIRECT_STATUS COMMENT_WRITE_MODE PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

WWW_ROOT="${WWW_ROOT:-/var/www/andy-y.cn}"
STAGE="${WWW_ROOT}/releases/.${RELEASE_ID}.staging"
FINAL="${WWW_ROOT}/releases/${RELEASE_ID}"
test ! -e "$STAGE"
test ! -e "$FINAL"

# Mark in-flight so rebuild-api can flip to dirty.
printf '%s\n' "{\"releaseId\":\"$RELEASE_ID\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
  >"$BUILD_LOCK_DIR/building"

cleanup_building() {
  rm -f "$BUILD_LOCK_DIR/building"
}
trap cleanup_building EXIT

cd "$APP_ROOT"

PHASE_T0=0
PHASE_NAME=""
progress() { printf 'PROGRESS %s\n' "$1" >&2; }
begin_phase() {
  if [[ -n "$PHASE_NAME" ]]; then
    local elapsed=$(( $(date +%s) - PHASE_T0 ))
    printf 'PROGRESS_TIMING %s %ss\n' "$PHASE_NAME" "$elapsed" >&2
  fi
  PHASE_NAME="$1"
  PHASE_T0=$(date +%s)
  progress "$1"
}
end_phases() {
  if [[ -n "$PHASE_NAME" ]]; then
    local elapsed=$(( $(date +%s) - PHASE_T0 ))
    printf 'PROGRESS_TIMING %s %ss\n' "$PHASE_NAME" "$elapsed" >&2
    PHASE_NAME=""
  fi
}

# Monorepo layout: /app is the repo root (not just astro/).
begin_phase tests
node --test scripts/cleanup-old-releases.test.js
node --test scripts/joe-task-markers.test.js
node --test scripts/compare-nginx-policy.test.js
node --test scripts/rebuild-progress.test.js
node --test scripts/copy-beoe-to-dist.test.js
begin_phase sync-typecho
node scripts/sync-typecho.js
node scripts/build-legacy-url-map.js
# Prerender every renderExpected English entry through the shared pipeline;
# content-level failures are isolated as render-rejected before the full build.
node scripts/prerender-en.js
begin_phase maps
node scripts/generate-nginx.js --status "$REDIRECT_STATUS"
node scripts/generate-comment-policy.js --mode "$COMMENT_WRITE_MODE" --out .cache/comment-policy.json
node scripts/generate-comment-policy.js --mode enabled --out .cache/comment-policy.staging.json
node scripts/generate-cdn-purge-plan.js --release-id "$RELEASE_ID" --out .cache/cdn-purge-plan.json
node scripts/finalize-manifest.js \
  --release-id "$RELEASE_ID" \
  --redirect-status "$REDIRECT_STATUS" \
  --comment-write-mode "$COMMENT_WRITE_MODE"
# Comment migration is a one-time cutover operation. Ordinary article rebuilds
# must never replay it against production Waline.

begin_phase astro
# Bounded fallback: if the full build fails and the error pins exactly one
# English entry, isolate it and retry once. Anything else fails the candidate.
if ! npm --prefix astro run build > .cache/astro-build.log 2>&1; then
  if node scripts/i18n-attribute-build-error.js .cache/astro-build.log; then
    echo "retrying astro build after isolating one en entry"
    if ! npm --prefix astro run build > .cache/astro-build-retry.log 2>&1; then
      cat .cache/astro-build-retry.log >&2
      echo "astro build failed on retry after isolation" >&2
      exit 1
    fi
  else
    cat .cache/astro-build.log >&2
    exit 1
  fi
else
  cat .cache/astro-build.log
fi
node scripts/generate-cdn-preheat-plan.js \
  --release-id "$RELEASE_ID" \
  --site-dir astro/dist \
  --out .cache/cdn-preheat-plan.json
begin_phase gates
gate_fail=0
node scripts/render-gate.js &
gate_render_pid=$!
node scripts/rss-gate.js &
gate_rss_pid=$!
node scripts/stage4-gate.js --expected-redirect "$REDIRECT_STATUS" &
gate_stage4_pid=$!
wait "$gate_render_pid" || gate_fail=1
wait "$gate_rss_pid" || gate_fail=1
wait "$gate_stage4_pid" || gate_fail=1
if [[ "$gate_fail" -ne 0 ]]; then
  echo "one or more gates failed" >&2
  exit 1
fi

mkdir -p "$STAGE/site" "$STAGE/nginx" .cache/release-nginx
begin_phase package
cp -a nginx/release-http.conf "$STAGE/nginx/"
cp -a nginx/00-release-loader.conf "$STAGE/nginx/" 2>/dev/null || true
# Candidate full nginx.conf for isolated nginx -t -c
node scripts/generate-candidate-nginx.js --release-id "$RELEASE_ID" --out "$STAGE/nginx"

cp -a astro/dist/. "$STAGE/site/"
cp .cache/manifest.json "$STAGE/manifest.json"
cp .cache/comment-policy.json "$STAGE/comment-policy.json"
cp .cache/comment-policy.staging.json "$STAGE/comment-policy.staging.json"
cp .cache/cdn-purge-plan.json "$STAGE/cdn-purge-plan.json"
cp .cache/cdn-preheat-plan.json "$STAGE/cdn-preheat-plan.json"
printf '%s\n' "$RELEASE_ID" > "$STAGE/site/release-id.txt"

if find "$STAGE" ! -type f ! -type d -print -quit | grep -q .; then
  echo "release contains non-file/dir entries" >&2
  exit 65
fi
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
(cd "$STAGE" && find . -type f ! -name checksums.sha256 -print0 | sort -z | xargs -0 sha256sum > checksums.sha256)
chmod 0644 "$STAGE/checksums.sha256"
mv -T "$STAGE" "$FINAL"
end_phases

# Clear pending; if dirty was set mid-build, leave it for the host to re-queue.
rm -f "$BUILD_LOCK_DIR/pending"
printf '%s\n' "$RELEASE_ID" >&3
