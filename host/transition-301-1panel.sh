#!/usr/bin/env bash
# One-time authorized 302 -> 301 cutover on 1Panel OpenResty.
# Ordinary rebuild/switch scripts stay on inherited state after this succeeds.
set -Eeuo pipefail
umask 077

WWW_ROOT="${WWW_ROOT:-/opt/1panel/www/sites/www.andy-y.cn/deploy}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
COMPOSE_DIR="${COMPOSE_DIR:-/var/www/andy-blog}"
VHOST_FILE="${VHOST_FILE:-/opt/1panel/www/conf.d/www.andy-y.cn.conf}"
REBUILD_PATH_UNIT="${REBUILD_PATH_UNIT:-blog-rebuild-1panel.path}"
OPENRESTY_BIN='/usr/local/openresty/bin/openresty'
EXPECTED_CURRENT_ID="${EXPECTED_CURRENT_ID:-20260819T083006Z-96a161e2}"
EXPECTED_PREVIOUS_ID="${EXPECTED_PREVIOUS_ID:-20260819T062045Z-b962d863}"
LEGACY_PROBE_PATH="${LEGACY_PROBE_PATH:-/archives/47/}"
LEGACY_PROBE_LOCATION="${LEGACY_PROBE_LOCATION:-https://www.andy-y.cn/posts/typecho-joe-mermaid/}"

[[ "$WWW_ROOT" == '/opt/1panel/www/sites/www.andy-y.cn/deploy' ]]
[[ "$STATE_DIR" == "$WWW_ROOT/state" ]]
[[ "$COMPOSE_DIR" == '/var/www/andy-blog' ]]
[[ "$VHOST_FILE" == '/opt/1panel/www/conf.d/www.andy-y.cn.conf' ]]
[[ "$EXPECTED_CURRENT_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]]
[[ "$EXPECTED_PREVIOUS_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]]
test -f "$VHOST_FILE"
test -f "$COMPOSE_DIR/scripts/flip-1panel-legacy-status.js"
test -f "$COMPOSE_DIR/scripts/materialize-301-release.js"
test -x "$COMPOSE_DIR/host/cdn-purge.sh"

[[ "$(cat "$STATE_DIR/redirect-status")" == '302' ]]
[[ "$(cat "$STATE_DIR/comment-write-mode")" == 'enabled' ]]
[[ "$(basename "$(readlink -f "$WWW_ROOT/current")")" == "$EXPECTED_CURRENT_ID" ]]
[[ "$(basename "$(readlink -f "$WWW_ROOT/previous")")" == "$EXPECTED_PREVIOUS_ID" ]]
[[ "$(cat "$STATE_DIR/last-success-release")" == "$EXPECTED_CURRENT_ID" ]]

mapfile -t OPENRESTY_NAMES < <(docker ps --format '{{.Names}}' | grep '^1Panel-openresty-' || true)
[[ "${#OPENRESTY_NAMES[@]}" -eq 1 ]]
OPENRESTY_CONTAINER="${OPENRESTY_NAMES[0]}"
[[ "$(docker inspect --format '{{.State.Running}}' "$OPENRESTY_CONTAINER")" == 'true' ]]

OLD_ID="$EXPECTED_CURRENT_ID"
OLD_PREVIOUS_TARGET="releases/$EXPECTED_PREVIOUS_ID"
OLD_EDGE_STATUS="$(cat "$STATE_DIR/edge-status")"
[[ "$OLD_EDGE_STATUS" =~ ^(edge-pending|edge-purged|edge-verified)$ ]]
systemctl is-active --quiet "$REBUILD_PATH_UNIT"

atomic_state_write() {
  local value="$1"
  local target="$2"
  printf '%s\n' "$value" >"$target.next"
  chmod --reference="$target" "$target.next"
  chown --reference="$target" "$target.next"
  mv -T "$target.next" "$target"
}

PATH_STOPPED=0
CONFIG_INSTALLED=0
SYMLINK_SWITCHED=0
STATE_FLIPPED=0
ORIGIN_PROBES_PASSED=0
VHOST_BACKUP=''
NEW_ID=''

restore_transaction() {
  set +e
  RESTORE_RC=0
  if [[ "$STATE_FLIPPED" -eq 1 ]]; then
    atomic_state_write '302' "$STATE_DIR/redirect-status" || RESTORE_RC=1
    atomic_state_write "$OLD_ID" "$STATE_DIR/last-success-release" || RESTORE_RC=1
    atomic_state_write "$OLD_EDGE_STATUS" "$STATE_DIR/edge-status" || RESTORE_RC=1
  fi
  if [[ "$SYMLINK_SWITCHED" -eq 1 ]]; then
    ln -sfn "releases/$OLD_ID" "$WWW_ROOT/current.next" || RESTORE_RC=1
    mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current" || RESTORE_RC=1
    ln -sfn "$OLD_PREVIOUS_TARGET" "$WWW_ROOT/previous.next" || RESTORE_RC=1
    mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous" || RESTORE_RC=1
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
  set -e
  return "$RESTORE_RC"
}

on_exit() {
  RC=$?
  trap - EXIT
  ROLLBACK_RC=0
  if [[ "$RC" -ne 0 && "$ORIGIN_PROBES_PASSED" -eq 0 ]]; then restore_transaction || ROLLBACK_RC=$?; fi
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

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CANDIDATE_DIR="$STATE_DIR/transition-301-candidates/$STAMP"
mkdir -p "$CANDIDATE_DIR"
chmod 0700 "$STATE_DIR/transition-301-candidates" "$CANDIDATE_DIR"
CANDIDATE_VHOST="$CANDIDATE_DIR/www.andy-y.cn.conf.candidate"
node "$COMPOSE_DIR/scripts/flip-1panel-legacy-status.js" --write-candidate "$VHOST_FILE" "$CANDIDATE_VHOST"
node "$COMPOSE_DIR/scripts/flip-1panel-legacy-status.js" --validate "$VHOST_FILE" "$CANDIDATE_VHOST"

NEW_SUFFIX="$(sha256sum "$CANDIDATE_VHOST" | awk '{print substr($1,1,8)}')"
NEW_ID="${STAMP}-${NEW_SUFFIX}"
NEW_DIR="$WWW_ROOT/releases/$NEW_ID"
[[ ! -e "$NEW_DIR" ]]
cp -a "$WWW_ROOT/releases/$OLD_ID" "$NEW_DIR"
node "$COMPOSE_DIR/scripts/materialize-301-release.js" \
  --release-dir "$NEW_DIR" \
  --release-id "$NEW_ID" \
  --from-id "$OLD_ID" \
  --legacy-map "$COMPOSE_DIR/data/legacy-url-map.json"
node "$COMPOSE_DIR/scripts/compare-nginx-policy.js" --status-flip-301 \
  "$WWW_ROOT/releases/$OLD_ID/nginx/release-http.conf" \
  "$NEW_DIR/nginx/release-http.conf"
(
  cd "$NEW_DIR"
  find . -type f ! -name checksums.sha256 -print0 | sort -z | xargs -0 sha256sum > checksums.sha256
)
chmod 0644 "$NEW_DIR/checksums.sha256"
(cd "$NEW_DIR" && sha256sum --check --status checksums.sha256)
grep -qx "$NEW_ID" "$NEW_DIR/site/release-id.txt"
if find "$NEW_DIR" ! -type f ! -type d -print -quit | grep -q .; then
  echo "301 candidate contains special files" >&2
  exit 65
fi

VHOST_BACKUP="$VHOST_FILE.bak-301-$STAMP"
cp -a "$VHOST_FILE" "$VHOST_BACKUP"
VHOST_OWNER="$(stat -c '%u' "$VHOST_FILE")"
VHOST_GROUP="$(stat -c '%g' "$VHOST_FILE")"
VHOST_MODE="$(stat -c '%a' "$VHOST_FILE")"
install -o "$VHOST_OWNER" -g "$VHOST_GROUP" -m "$VHOST_MODE" "$CANDIDATE_VHOST" "$VHOST_FILE.next"
CONFIG_INSTALLED=1
mv -T "$VHOST_FILE.next" "$VHOST_FILE"
docker exec "$OPENRESTY_CONTAINER" "$OPENRESTY_BIN" -t

ln -sfn "releases/$NEW_ID" "$WWW_ROOT/current.next"
ln -sfn "releases/$OLD_ID" "$WWW_ROOT/previous.next"
SYMLINK_SWITCHED=1
mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"

atomic_state_write '301' "$STATE_DIR/redirect-status"
atomic_state_write "$NEW_ID" "$STATE_DIR/last-success-release"
atomic_state_write 'edge-pending' "$STATE_DIR/edge-status"
STATE_FLIPPED=1

docker exec "$OPENRESTY_CONTAINER" "$OPENRESTY_BIN" -s reload
sleep 2

ORIGIN_RELEASE="$(curl -fsS --max-time 10 --http1.1 --resolve www.andy-y.cn:443:127.0.0.1 https://www.andy-y.cn/__release | tr -d '\r')"
LEGACY_RESULT="$(curl -sS --http1.1 --path-as-is --max-time 10 --max-redirs 0 -o /dev/null \
  -w '%{http_code}|%{redirect_url}' --resolve www.andy-y.cn:443:127.0.0.1 \
  "https://www.andy-y.cn${LEGACY_PROBE_PATH}")"
QUERY_RESULT="$(curl -sS --http1.1 --path-as-is --max-time 10 --max-redirs 0 -o /dev/null \
  -w '%{http_code}|%{redirect_url}' --resolve www.andy-y.cn:443:127.0.0.1 \
  'https://www.andy-y.cn/?p=47')"
HOME_STATUS="$(curl -sS --http1.1 --max-time 10 -o /dev/null -w '%{http_code}' \
  --resolve www.andy-y.cn:443:127.0.0.1 https://www.andy-y.cn/)"
ADMIN_STATUS="$(curl -sS --http1.1 --max-time 10 -o /dev/null -w '%{http_code}' \
  --resolve www.andy-y.cn:443:127.0.0.1 https://www.andy-y.cn/admin/)"
COMMENT_GET_STATUS="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  -H 'Origin: https://www.andy-y.cn' -H 'Referer: https://www.andy-y.cn/' \
  'http://127.0.0.1:8360/api/comment?path=%2Fposts%2Ftypecho-joe-mermaid%2F')"
printf 'probe origin=%s legacy=%s query=%s home=%s admin=%s comment=%s\n' \
  "$ORIGIN_RELEASE" "$LEGACY_RESULT" "$QUERY_RESULT" "$HOME_STATUS" "$ADMIN_STATUS" "$COMMENT_GET_STATUS"
[[ "$ORIGIN_RELEASE" == "$NEW_ID" ]]
[[ "$LEGACY_RESULT" == "301|${LEGACY_PROBE_LOCATION}" ]]
[[ "$QUERY_RESULT" == "301|${LEGACY_PROBE_LOCATION}" ]]
[[ "$HOME_STATUS" == '200' ]]
[[ "$ADMIN_STATUS" == '404' ]]
[[ "$COMMENT_GET_STATUS" == '200' ]]
[[ "$(cat "$STATE_DIR/redirect-status")" == '301' ]]
[[ "$(cat "$STATE_DIR/comment-write-mode")" == 'enabled' ]]
ORIGIN_PROBES_PASSED=1

set -a
# shellcheck disable=SC1091
. /etc/andy-blog/aliyun-cdn.env
# shellcheck disable=SC1091
. /etc/andy-blog/cloudflare.env
set +a

set +e
WWW_ROOT="$WWW_ROOT" STATE_DIR="$STATE_DIR" COMPOSE_DIR="$COMPOSE_DIR" \
  "$COMPOSE_DIR/host/cdn-purge.sh" "$NEW_ID"
PURGE_RC=$?
set -e
if [[ "$PURGE_RC" -ne 0 ]]; then
  systemctl start "$REBUILD_PATH_UNIT"
  PATH_STOPPED=0
  trap - EXIT
  echo "origin 301 switch succeeded but dual-CDN purge failed rc=$PURGE_RC" >&2
  exit 75
fi

systemctl start "$REBUILD_PATH_UNIT"
PATH_STOPPED=0
trap - EXIT
printf '%s\n' "301 transition complete: release=$NEW_ID previous=$OLD_ID backup=$VHOST_BACKUP edge=edge-purged"
