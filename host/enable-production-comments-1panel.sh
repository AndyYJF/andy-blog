#!/usr/bin/env bash
# Authorized Phase 9c only: install and switch one reviewed 302+enabled release.
set -Eeuo pipefail
umask 077

archive="${PHASE9C_ARCHIVE:?set reviewed archive path}"
archive_sha="${PHASE9C_ARCHIVE_SHA256:?set reviewed archive SHA-256}"
release_id="${PHASE9C_RELEASE_ID:?set reviewed release id}"
expected_current="${PHASE9C_EXPECTED_CURRENT:?set exact current release id}"
expected_source_head="${PHASE9C_SOURCE_HEAD:?set reviewed source HEAD}"
evidence_dir="${PHASE9C_EVIDENCE_DIR:?set new root-only evidence directory}"
deploy_root="${PHASE9C_WWW_ROOT:-/opt/1panel/www/sites/www.andy-y.cn/deploy}"
state_dir="$deploy_root/state"
mysql_container='1Panel-mysql-RSa9'
typecho_container='1Panel-typecho-f31a'
waline_container='andy-blog-waline-waline-1'
package_name="stage10-phase9c-$release_id"
extract_root="$evidence_dir/extracted"
package_root="$extract_root/$package_name"
candidate_release="$package_root/release/$release_id"
release_install="$deploy_root/releases/.$release_id.installing"
release_root="$deploy_root/releases/$release_id"
transition_script="$package_root/meta/transition-deploy-state.sh"
marker="stage10-phase9c-$release_id"
closed_key='/posts/typecho-joe-mermaid/'
open_key='/posts/stable-diffusion-notes-p1/'
unknown_key='/posts/stage10-unknown-key/'

fail() { printf 'PHASE9C_ENABLE_FAIL: %s\n' "$1" >&2; exit 64; }
mysql_root_query() {
  local sql="$1"
  docker exec "$mysql_container" sh -lc \
    'mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" -e "$1"' sh "$sql" 2>/dev/null
}
dump_waline() {
  docker exec "$mysql_container" sh -lc \
    'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --databases waline' 2>/dev/null
}
origin_curl() {
  curl --noproxy '*' --resolve 'www.andy-y.cn:443:127.0.0.1' "$@"
}
post_probe() {
  local payload="$1"
  local response="$2"
  origin_curl -sS -o "$response" -w '%{http_code}' \
    -H 'Origin: https://www.andy-y.cn' \
    -H 'Referer: https://www.andy-y.cn/' \
    -H 'Content-Type: application/json' \
    --data-binary "@$payload" 'https://www.andy-y.cn/api/comment'
}

state_changed='false'
switched='false'
evidence_ready='false'
rollback_on_error() {
  local original_status="$?"
  local rollback_status=0
  trap - EXIT
  set +e
  if test "$original_status" != '0' && test "$switched" = 'true'; then
    ln -s "releases/$expected_current" "$deploy_root/current.rollback-$release_id" || rollback_status="$?"
    if test "$rollback_status" = '0'; then
      mv -Tf "$deploy_root/current.rollback-$release_id" "$deploy_root/current" || rollback_status="$?"
    fi
    if test "$rollback_status" = '0'; then
      ln -s "releases/$release_id" "$deploy_root/previous.rollback-$release_id" || rollback_status="$?"
      mv -Tf "$deploy_root/previous.rollback-$release_id" "$deploy_root/previous" || rollback_status="$?"
    fi
  fi
  if test "$original_status" != '0' && test "$state_changed" = 'true' && test -x "$transition_script"; then
    WWW_ROOT="$deploy_root" STATE_DIR="$state_dir" \
      "$transition_script" comment-write-mode disabled >> "$evidence_dir/rollback-state.txt" 2>&1 \
      || rollback_status="$?"
  fi
  if test "$original_status" != '0' && test "$evidence_ready" = 'true'; then
    origin_curl -fsS 'https://www.andy-y.cn/__release' > "$evidence_dir/rollback-release.txt" 2>&1 || rollback_status="$?"
    printf 'original_status=%s\nrollback_status=%s\nnative_probe_may_persist=%s\n' \
      "$original_status" "$rollback_status" "$(test -f "$evidence_dir/open-post.response.json" && echo true || echo false)" \
      > "$evidence_dir/rollback-summary.txt"
    chmod 600 "$evidence_dir/rollback-summary.txt" 2>/dev/null || true
  fi
  set -e
  if test "$rollback_status" != '0'; then
    printf 'PHASE9C_ROLLBACK_FAILED: manual intervention required\n' >&2
    exit 70
  fi
  exit "$original_status"
}
trap rollback_on_error EXIT

test "$(id -u)" = '0' || fail 'not root'
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail 'bad release id'
[[ "$expected_current" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail 'bad current release id'
[[ "$archive_sha" =~ ^[a-f0-9]{64}$ ]] || fail 'bad archive SHA-256'
[[ "$expected_source_head" =~ ^[a-f0-9]{40}$ ]] || fail 'bad source HEAD'
test -f "$archive" || fail 'archive missing'
test "$(sha256sum "$archive" | awk '{print $1}')" = "$archive_sha" || fail 'archive hash mismatch'
test ! -e "$evidence_dir" || fail 'evidence directory already exists'
test ! -e "$release_install" || fail 'release install path exists'
test ! -e "$release_root" || fail 'release already exists'
test "$(readlink "$deploy_root/current")" = "releases/$expected_current" || fail 'current release drifted'
test "$(tr -d '\r\n' < "$state_dir/redirect-status")" = '302' || fail 'redirect status drifted'
test "$(tr -d '\r\n' < "$state_dir/comment-write-mode")" = 'disabled' || fail 'comment mode is not disabled'
test "$(docker inspect --format '{{.State.Running}}' "$typecho_container")" = 'true' || fail 'Typecho is not running'
test "$(docker inspect --format '{{.State.Health.Status}}' "$waline_container")" = 'healthy' || fail 'production Waline is not healthy'
test "$(mysql_root_query 'SELECT CONCAT(cid,"|",allowComment) FROM typecho_frf6hh.typecho_contents WHERE cid=47')" = '47|0' || fail 'CID47 is not closed'
test "$(mysql_root_query 'SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA="typecho_frf6hh" AND EVENT_OBJECT_TABLE="typecho_comments" AND ACTION_TIMING="BEFORE" AND ACTION_STATEMENT LIKE "%TYPECHO_COMMENTS_READ_ONLY_AFTER_ASTRO_CUTOVER%"')" = '3' || fail 'Typecho comment guard mismatch'
test "$(mysql_root_query 'SELECT CONCAT((SELECT COUNT(*) FROM typecho_frf6hh.typecho_comments),"|",(SELECT COUNT(*) FROM waline.wl_Comment),"|",(SELECT COUNT(*) FROM waline.astro_comment_migration_map))')" = '2|2|2' || fail 'pre-enable comment counts drifted'

mkdir "$evidence_dir"
chmod 700 "$evidence_dir"
evidence_ready='true'
readlink "$deploy_root/current" > "$evidence_dir/current.before.txt"
if test -L "$deploy_root/previous"; then readlink "$deploy_root/previous" > "$evidence_dir/previous.before.txt"; else printf 'missing\n' > "$evidence_dir/previous.before.txt"; fi
cp "$state_dir/redirect-status" "$evidence_dir/redirect-status.before.txt"
cp "$state_dir/comment-write-mode" "$evidence_dir/comment-write-mode.before.txt"
cp "$deploy_root/current/manifest.json" "$evidence_dir/manifest.before.json"
cp "$deploy_root/current/comment-policy.json" "$evidence_dir/comment-policy.before.json"
dump_waline | gzip -9 > "$evidence_dir/waline-before-enable.sql.gz"
gzip -t "$evidence_dir/waline-before-enable.sql.gz"
test -s "$evidence_dir/waline-before-enable.sql.gz" || fail 'Waline backup is empty'

mkdir "$extract_root"
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then fail 'unsafe archive path'; fi
tar -xzf "$archive" -C "$extract_root"
if find "$extract_root" ! -type f ! -type d -print -quit | grep -q .; then fail 'archive contains special files'; fi
test -x "$transition_script" || chmod 700 "$transition_script"
node "$package_root/meta/phase9c-validate-release.mjs" --release-dir "$candidate_release" --release-id "$release_id" \
  > "$evidence_dir/candidate-validation.json"
node - "$package_root/meta/deployment.json" "$release_id" "$expected_current" "$expected_source_head" <<'NODE'
const fs = require('fs');
const [,, metadataPath, releaseId, previousReleaseId, sourceHead] = process.argv;
const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (value.phase !== 'stage10-phase9c-comment-enable'
  || value.releaseId !== releaseId || value.previousReleaseId !== previousReleaseId
  || value.sourceHead !== sourceHead || value.sourceWorktree !== 'clean'
  || value.redirectStatus !== 302 || value.commentWriteMode !== 'enabled'
  || value.closedCommentKey !== '/posts/typecho-joe-mermaid/'
  || value.openProbeKey !== '/posts/stable-diffusion-notes-p1/'
  || value.targetHost !== 'www.andy-y.cn') throw new Error('deployment metadata mismatch');
NODE
cmp -s "$deploy_root/current/nginx/release-http.conf" "$candidate_release/nginx/release-http.conf" \
  || fail 'Nginx maps changed; Phase 9c may not reload OpenResty'

mkdir "$release_install"
cp -a "$candidate_release/." "$release_install/"
find "$release_install" -type d -exec chmod 0755 {} +
find "$release_install" -type f -exec chmod 0644 {} +
node "$package_root/meta/phase9c-validate-release.mjs" --release-dir "$release_install" --release-id "$release_id" \
  > "$evidence_dir/installed-validation.json"
mv "$release_install" "$release_root"

WWW_ROOT="$deploy_root" STATE_DIR="$state_dir" \
  "$transition_script" comment-write-mode enabled > "$evidence_dir/state-transition.txt"
state_changed='true'
test "$(tr -d '\r\n' < "$state_dir/comment-write-mode")" = 'enabled' || fail 'state transition did not persist enabled'

ln -s "releases/$release_id" "$deploy_root/current.next-$release_id"
ln -s "releases/$expected_current" "$deploy_root/previous.next-$release_id"
mv -Tf "$deploy_root/previous.next-$release_id" "$deploy_root/previous"
mv -Tf "$deploy_root/current.next-$release_id" "$deploy_root/current"
switched='true'

test "$(origin_curl -fsS 'https://www.andy-y.cn/__release' | tr -d '\r\n')" = "$release_id" || fail 'origin release marker mismatch'
test "$(readlink "$deploy_root/current")" = "releases/$release_id" || fail 'current symlink mismatch'
test "$(readlink "$deploy_root/previous")" = "releases/$expected_current" || fail 'previous symlink mismatch'
node "$package_root/meta/phase9c-validate-release.mjs" --release-dir "$deploy_root/current" --release-id "$release_id" \
  > "$evidence_dir/current-validation.json"

node - "$evidence_dir" "$release_id" "$closed_key" "$unknown_key" "$open_key" <<'NODE'
const fs = require('fs');
const [,, dir, releaseId, closedKey, unknownKey, openKey] = process.argv;
const common = { nick: 'Stage 10 Probe', mail: 'stage10-probe@andy-y.cn', link: '' };
for (const [name, url] of [['closed', closedKey], ['unknown', unknownKey], ['open', openKey]]) {
  const payload = { ...common, comment: `Stage 10 Phase 9c probe ${name} stage10-phase9c-${releaseId}`, url };
  fs.writeFileSync(`${dir}/${name}-post.payload.json`, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: 'wx' });
}
NODE

closed_status="$(post_probe "$evidence_dir/closed-post.payload.json" "$evidence_dir/closed-post.response.json")"
test "$closed_status" = '403' || fail "closed key status=$closed_status"
grep -Fq 'entry-not-writable' "$evidence_dir/closed-post.response.json" || fail 'closed key reason mismatch'
unknown_status="$(post_probe "$evidence_dir/unknown-post.payload.json" "$evidence_dir/unknown-post.response.json")"
test "$unknown_status" = '403' || fail "unknown key status=$unknown_status"
grep -Fq 'unknown-key' "$evidence_dir/unknown-post.response.json" || fail 'unknown key reason mismatch'
test "$(mysql_root_query 'SELECT CONCAT((SELECT COUNT(*) FROM waline.wl_Comment),"|",(SELECT COUNT(*) FROM waline.astro_comment_migration_map))')" = '2|2' || fail 'denied probes changed Waline'

open_status="$(post_probe "$evidence_dir/open-post.payload.json" "$evidence_dir/open-post.response.json")"
test "$open_status" = '200' || fail "open key status=$open_status"
test "$(mysql_root_query "SELECT COUNT(*) FROM waline.wl_Comment WHERE comment LIKE '%$marker%' AND url='$open_key'")" = '1' || fail 'open probe marker row mismatch'
test "$(mysql_root_query 'SELECT CONCAT((SELECT COUNT(*) FROM waline.wl_Comment),"|",(SELECT COUNT(*) FROM waline.astro_comment_migration_map),"|",(SELECT COUNT(*) FROM waline.wl_Comment c LEFT JOIN waline.astro_comment_migration_map m ON m.waline_id=c.id WHERE m.waline_id IS NULL))')" = '3|2|1' || fail 'post-enable native/mapped counts mismatch'
mysql_root_query "SELECT CONCAT(id,'|',status,'|',url,'|',SHA2(comment,256)) FROM waline.wl_Comment WHERE comment LIKE '%$marker%' AND url='$open_key'" \
  > "$evidence_dir/native-probe-row.txt"
test "$(wc -l < "$evidence_dir/native-probe-row.txt" | tr -d ' ')" = '1' || fail 'native probe summary count mismatch'

test "$(mysql_root_query 'SELECT CONCAT((SELECT COUNT(*) FROM typecho_frf6hh.typecho_comments),"|",(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA="typecho_frf6hh" AND EVENT_OBJECT_TABLE="typecho_comments" AND ACTION_TIMING="BEFORE" AND ACTION_STATEMENT LIKE "%TYPECHO_COMMENTS_READ_ONLY_AFTER_ASTRO_CUTOVER%"))')" = '2|3' || fail 'Typecho readonly invariant changed'
get_status="$(origin_curl -sS -o "$evidence_dir/final-known-key-get.json" -w '%{http_code}' \
  -H 'Origin: https://www.andy-y.cn' -H 'Referer: https://www.andy-y.cn/' \
  --get --data-urlencode "path=$closed_key" 'https://www.andy-y.cn/api/comment')"
test "$get_status" = '200' || fail "final Waline GET status=$get_status"
test "$(tr -d '\r\n' < "$state_dir/redirect-status")" = '302' || fail 'redirect status changed'
test "$(tr -d '\r\n' < "$state_dir/comment-write-mode")" = 'enabled' || fail 'comment state is not enabled'

{
  printf 'utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'release=%s\nprevious=%s\nsource_head=%s\n' "$release_id" "$expected_current" "$expected_source_head"
  printf 'redirect_status=302\ncomment_write_mode=enabled\n'
  printf 'closed_key_status=403|entry-not-writable\nunknown_key_status=403|unknown-key\n'
  printf 'open_key_status=200\nnative_probe_rows=1\ntypecho_mappings=2\nwaline_comments=3\n'
  printf 'typecho_comments=2\ntypecho_guard_triggers=3\nwaline_get=200\n'
  printf 'vhost_reload_executed=false\ncdn_purge_executed=false\n'
} > "$evidence_dir/phase9c-summary.txt"
find "$evidence_dir" -maxdepth 1 -type f -exec chmod 0600 {} +
sha256sum "$archive" "$evidence_dir/waline-before-enable.sql.gz" "$evidence_dir/phase9c-summary.txt" \
  > "$evidence_dir/SHA256SUMS.phase9c"
chmod 600 "$evidence_dir/SHA256SUMS.phase9c"

cat "$evidence_dir/phase9c-summary.txt"
printf 'PHASE9C_ENABLE_OK\n'
trap - EXIT
