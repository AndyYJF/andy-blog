#!/usr/bin/env bash
# Build and atomically deploy the one-line decoded legacy-map repair on 1Panel.
# This transaction is locked to 302 + enabled and never invokes CDN purge or POST.
set -Eeuo pipefail
umask 077

WWW_ROOT="${WWW_ROOT:?set production deploy root}"
STATE_DIR="${STATE_DIR:?set production state dir}"
COMPOSE_DIR="${COMPOSE_DIR:?set deployed source dir}"
VHOST_FILE="${VHOST_FILE:-/opt/1panel/www/conf.d/www.andy-y.cn.conf}"
OPENRESTY_CONTAINER="${OPENRESTY_CONTAINER:?set active 1Panel OpenResty container}"
OPENRESTY_IMAGE_ID="${OPENRESTY_IMAGE_ID:?set expected OpenResty image id}"
EXPECTED_SOURCE_REVISION="${EXPECTED_SOURCE_REVISION:?set reviewed 40-hex source revision}"
EXPECTED_CURRENT_ID="${EXPECTED_CURRENT_ID:?set current release id}"
EXPECTED_VHOST_SHA256="${EXPECTED_VHOST_SHA256:?set active vhost sha256}"
REBUILD_PATH_UNIT="${REBUILD_PATH_UNIT:-blog-rebuild-1panel.path}"
OPENRESTY_BIN='/usr/local/openresty/bin/openresty'
COMPOSE_FILE="$COMPOSE_DIR/compose.1panel-cms.yml"
SOURCE_REVISION_FILE="$COMPOSE_DIR/.deploy-source-revision"

[[ "$WWW_ROOT" == '/opt/1panel/www/sites/www.andy-y.cn/deploy' ]]
[[ "$STATE_DIR" == "$WWW_ROOT/state" ]]
[[ "$COMPOSE_DIR" == '/var/www/andy-blog' ]]
[[ "$VHOST_FILE" == '/opt/1panel/www/conf.d/www.andy-y.cn.conf' ]]
[[ "$EXPECTED_SOURCE_REVISION" =~ ^[a-f0-9]{40}$ ]]
[[ "$EXPECTED_CURRENT_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]
[[ "$EXPECTED_VHOST_SHA256" =~ ^[a-f0-9]{64}$ ]]
test -f "$COMPOSE_FILE"
test -f "$SOURCE_REVISION_FILE"
grep -qx "$EXPECTED_SOURCE_REVISION" "$SOURCE_REVISION_FILE"
test -f "$VHOST_FILE"
test -f "$STATE_DIR/edge-status"

[[ "$(cat "$STATE_DIR/redirect-status")" == '302' ]]
[[ "$(cat "$STATE_DIR/comment-write-mode")" == 'enabled' ]]
[[ "$(basename "$(readlink -f "$WWW_ROOT/current")")" == "$EXPECTED_CURRENT_ID" ]]
[[ "$(sha256sum "$VHOST_FILE" | awk '{print $1}')" == "$EXPECTED_VHOST_SHA256" ]]
[[ "$(docker inspect --format '{{.Image}}' "$OPENRESTY_CONTAINER")" == "$OPENRESTY_IMAGE_ID" ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$OPENRESTY_CONTAINER")" == 'true' ]]
systemctl is-active --quiet "$REBUILD_PATH_UNIT"

OLD_ID="$EXPECTED_CURRENT_ID"
OLD_PREVIOUS_TARGET="$(readlink "$WWW_ROOT/previous")"
OLD_LAST_SUCCESS="$(cat "$STATE_DIR/last-success-release")"
OLD_EDGE_STATUS="$(cat "$STATE_DIR/edge-status")"
[[ "$OLD_PREVIOUS_TARGET" =~ ^releases/[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]
[[ "$OLD_LAST_SUCCESS" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]
[[ "$OLD_EDGE_STATUS" =~ ^(edge-pending|edge-purged|edge-verified)$ ]]
cd "$COMPOSE_DIR"
OLD_BUILDER_SERVICE_ID="$(docker compose -f "$COMPOSE_FILE" images -q builder)"
[[ -n "$OLD_BUILDER_SERVICE_ID" ]]
OLD_BUILDER_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$OLD_BUILDER_SERVICE_ID")"
[[ "$OLD_BUILDER_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
OLD_BUILDER_IMAGE_REF="$(docker compose -f "$COMPOSE_FILE" images --format json builder | node -e '
  let input = require("fs").readFileSync(0, "utf8").trim();
  let rows;
  try { rows = JSON.parse(input); } catch { rows = input.split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  if (!Array.isArray(rows)) rows = [rows];
  if (rows.length !== 1 || !rows[0].Repository || !rows[0].Tag) process.exit(1);
  process.stdout.write(`${rows[0].Repository}:${rows[0].Tag}`);
')"
[[ "$OLD_BUILDER_IMAGE_REF" != *'<none>'* && "$OLD_BUILDER_IMAGE_REF" == *:* ]]
PATH_STOPPED=0
CONFIG_INSTALLED=0
SYMLINK_SWITCHED=0
BUILDER_RETAG_REQUIRED=0
VHOST_BACKUP=''

atomic_state_write() {
  local value="$1"
  local target="$2"
  printf '%s\n' "$value" >"$target.next"
  chmod --reference="$target" "$target.next"
  chown --reference="$target" "$target.next"
  mv -T "$target.next" "$target"
}

restore_transaction() {
  set +e
  RESTORE_RC=0
  if [[ "$SYMLINK_SWITCHED" -eq 1 ]]; then
    ln -sfn "releases/$OLD_ID" "$WWW_ROOT/current.next" || RESTORE_RC=1
    mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current" || RESTORE_RC=1
    ln -sfn "$OLD_PREVIOUS_TARGET" "$WWW_ROOT/previous.next" || RESTORE_RC=1
    mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous" || RESTORE_RC=1
    atomic_state_write "$OLD_LAST_SUCCESS" "$STATE_DIR/last-success-release" || RESTORE_RC=1
    atomic_state_write "$OLD_EDGE_STATUS" "$STATE_DIR/edge-status" || RESTORE_RC=1
  fi
  if [[ "$CONFIG_INSTALLED" -eq 1 && -f "$VHOST_BACKUP" ]]; then
    VHOST_OWNER="$(stat -c '%u' "$VHOST_BACKUP")"
    VHOST_GROUP="$(stat -c '%g' "$VHOST_BACKUP")"
    VHOST_MODE="$(stat -c '%a' "$VHOST_BACKUP")"
    install -o "$VHOST_OWNER" -g "$VHOST_GROUP" -m "$VHOST_MODE" "$VHOST_BACKUP" "$VHOST_FILE.next" || RESTORE_RC=1
    mv -T "$VHOST_FILE.next" "$VHOST_FILE" || RESTORE_RC=1
    docker exec "$OPENRESTY_CONTAINER" "$OPENRESTY_BIN" -t || RESTORE_RC=1
    docker exec "$OPENRESTY_CONTAINER" "$OPENRESTY_BIN" -s reload || RESTORE_RC=1
  fi
  if [[ "$BUILDER_RETAG_REQUIRED" -eq 1 ]]; then
    docker image tag "$OLD_BUILDER_IMAGE_ID" "$OLD_BUILDER_IMAGE_REF" || RESTORE_RC=1
  fi
  set -e
  return "$RESTORE_RC"
}

on_exit() {
  RC=$?
  trap - EXIT
  ROLLBACK_RC=0
  if [[ "$RC" -ne 0 ]]; then restore_transaction || ROLLBACK_RC=$?; fi
  if [[ "$PATH_STOPPED" -eq 1 && "$ROLLBACK_RC" -eq 0 ]]; then
    systemctl start "$REBUILD_PATH_UNIT" || ROLLBACK_RC=$?
  fi
  if [[ "$ROLLBACK_RC" -ne 0 ]]; then
    printf '%s\n' "rollback incomplete; watcher left stopped; rollback_rc=$ROLLBACK_RC" >&2
    exit 70
  fi
  exit "$RC"
}
trap on_exit EXIT

systemctl stop "$REBUILD_PATH_UNIT"
PATH_STOPPED=1

BUILDER_SOURCE_REVISION="$EXPECTED_SOURCE_REVISION" docker compose -f "$COMPOSE_FILE" build builder
BUILDER_SERVICE_ID="$(docker compose -f "$COMPOSE_FILE" images -q builder)"
[[ -n "$BUILDER_SERVICE_ID" ]]
BUILDER_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$BUILDER_SERVICE_ID")"
if [[ "$BUILDER_IMAGE_ID" != "$OLD_BUILDER_IMAGE_ID" ]]; then BUILDER_RETAG_REQUIRED=1; fi
[[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$BUILDER_IMAGE_ID")" == "$EXPECTED_SOURCE_REVISION" ]]

SNAPSHOT_EPOCH="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY builder node /app/scripts/read-db-epoch.js)"
[[ "$SNAPSHOT_EPOCH" =~ ^[0-9]{10}$ ]]
RELEASE_ID="$(docker compose -f "$COMPOSE_FILE" run --rm --no-TTY \
  -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" -e REDIRECT_STATUS=302 -e COMMENT_WRITE_MODE=enabled \
  -e WWW_ROOT=/var/www/andy-y.cn builder bash /app/scripts/build-release.sh \
  | tr -d '\r' | tail -n1)"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]
RELEASE_DIR="$WWW_ROOT/releases/$RELEASE_ID"

CANDIDATE_DIR="$STATE_DIR/mapping-repair-candidates/$RELEASE_ID"
mkdir -p "$CANDIDATE_DIR"
chmod 0700 "$STATE_DIR/mapping-repair-candidates" "$CANDIDATE_DIR"
CANDIDATE_VHOST="$CANDIDATE_DIR/www.andy-y.cn.conf.candidate"
node "$COMPOSE_DIR/scripts/generate-1panel-www-nginx.js" \
  --input "$RELEASE_DIR/nginx/release-http.conf" \
  --out "$CANDIDATE_VHOST"
node "$COMPOSE_DIR/scripts/validate-1panel-mapping-repair.js" \
  --current-vhost "$VHOST_FILE" \
  --candidate-vhost "$CANDIDATE_VHOST" \
  --release-dir "$RELEASE_DIR" \
  --release-id "$RELEASE_ID"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
VHOST_BACKUP="$VHOST_FILE.bak-mapping-$STAMP"
cp -a "$VHOST_FILE" "$VHOST_BACKUP"
VHOST_OWNER="$(stat -c '%u' "$VHOST_FILE")"
VHOST_GROUP="$(stat -c '%g' "$VHOST_FILE")"
VHOST_MODE="$(stat -c '%a' "$VHOST_FILE")"
install -o "$VHOST_OWNER" -g "$VHOST_GROUP" -m "$VHOST_MODE" "$CANDIDATE_VHOST" "$VHOST_FILE.next"
mv -T "$VHOST_FILE.next" "$VHOST_FILE"
CONFIG_INSTALLED=1
docker exec "$OPENRESTY_CONTAINER" "$OPENRESTY_BIN" -t

ln -sfn "releases/$RELEASE_ID" "$WWW_ROOT/current.next"
ln -sfn "releases/$OLD_ID" "$WWW_ROOT/previous.next"
SYMLINK_SWITCHED=1
mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"
docker exec "$OPENRESTY_CONTAINER" "$OPENRESTY_BIN" -s reload

ORIGIN_RELEASE="$(curl -fsS --max-time 10 --resolve www.andy-y.cn:443:127.0.0.1 https://www.andy-y.cn/__release)"
[[ "$ORIGIN_RELEASE" == "$RELEASE_ID" ]]
LEGACY_RESULT="$(curl -sS --path-as-is --max-time 10 --max-redirs 0 -o /dev/null \
  -w '%{http_code}|%{redirect_url}' --resolve www.andy-y.cn:443:127.0.0.1 \
  'https://www.andy-y.cn/index.php/tag/%E5%88%86%E6%9E%90fen-x/')"
[[ "$LEGACY_RESULT" == '302|https://www.andy-y.cn/tag/fen-x/' ]]
ADMIN_STATUS="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  --resolve www.andy-y.cn:443:127.0.0.1 https://www.andy-y.cn/admin/)"
[[ "$ADMIN_STATUS" == '404' ]]
COMMENT_GET_STATUS="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  -H 'Origin: https://www.andy-y.cn' -H 'Referer: https://www.andy-y.cn/' \
  'http://127.0.0.1:8360/api/comment?path=%2Fposts%2Ftypecho-joe-mermaid%2F')"
[[ "$COMMENT_GET_STATUS" == '200' ]]
[[ "$(cat "$STATE_DIR/redirect-status")" == '302' ]]
[[ "$(cat "$STATE_DIR/comment-write-mode")" == 'enabled' ]]

atomic_state_write "$RELEASE_ID" "$STATE_DIR/last-success-release"
atomic_state_write 'edge-pending' "$STATE_DIR/edge-status"
systemctl start "$REBUILD_PATH_UNIT"
PATH_STOPPED=0
trap - EXIT
printf '%s\n' "mapping repair deployed: release=$RELEASE_ID backup=$VHOST_BACKUP edge=edge-pending"
