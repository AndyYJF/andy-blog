#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

mysql_container='1Panel-mysql-RSa9'
typecho_container='1Panel-typecho-f31a'
database='typecho_frf6hh'
comments_table='typecho_comments'
contents_table='typecho_contents'
www_root='/opt/1panel/www/sites/www.andy-y.cn/deploy'
evidence_dir="${STAGE10_COMMENT_EVIDENCE_DIR:?set root-only Phase 9 evidence directory}"
guard_marker='TYPECHO_COMMENTS_READ_ONLY_AFTER_ASTRO_CUTOVER'
insert_trigger='astro_stage10_typecho_comments_no_insert'
update_trigger='astro_stage10_typecho_comments_no_update'
delete_trigger='astro_stage10_typecho_comments_no_delete'

fail() {
  printf 'TYPECHO_COMMENT_GUARD_FAIL: %s\n' "$1" >&2
  exit 64
}

mysql_root() {
  docker exec -i "$mysql_container" sh -lc \
    'exec mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" typecho_frf6hh'
}

comment_state() {
  mysql_root 2>/dev/null <<'SQL'
SET SESSION group_concat_max_len=1048576;
SELECT CONCAT('rows=', COUNT(*)) FROM typecho_comments;
SELECT CONCAT('max_coid=', COALESCE(MAX(coid),0)) FROM typecho_comments;
SELECT CONCAT('canonical_sha256=', SHA2(COALESCE(GROUP_CONCAT(
  SHA2(CONCAT_WS(CHAR(31),coid,cid,created,author,authorId,ownerId,mail,
    COALESCE(url,''),ip,agent,text,type,status,parent),256)
  ORDER BY coid SEPARATOR ''),''),256)) FROM typecho_comments;
SELECT CONCAT('allow_comment_sha256=', SHA2(COALESCE(GROUP_CONCAT(
  CONCAT(cid,':',allowComment) ORDER BY cid SEPARATOR '|'),''),256))
  FROM typecho_contents;
SQL
}

drop_trigger() {
  local trigger="$1"
  printf 'DROP TRIGGER IF EXISTS `%s`;\n' "$trigger" | mysql_root >/dev/null 2>&1
}

created_insert='false'
created_update='false'
created_delete='false'
rollback_guard_on_exit() {
  local original_status="$?"
  local rollback_status=0
  trap - EXIT
  set +e
  if test "$created_delete" = 'true'; then drop_trigger "$delete_trigger" || rollback_status="$?"; fi
  if test "$created_update" = 'true'; then drop_trigger "$update_trigger" || rollback_status="$?"; fi
  if test "$created_insert" = 'true'; then drop_trigger "$insert_trigger" || rollback_status="$?"; fi
  set -e
  if test "$rollback_status" != '0'; then
    printf 'TYPECHO_COMMENT_GUARD_ROLLBACK_FAILED: manual intervention required\n' >&2
    exit 70
  fi
  exit "$original_status"
}
trap rollback_guard_on_exit EXIT

expect_blocked() {
  local event="$1"
  local statement="$2"
  local output="$evidence_dir/guard-${event,,}-probe.txt"
  local status=0
  set +e
  printf '%s\n' "$statement" | mysql_root > "$output" 2>&1
  status="$?"
  set -e
  chmod 600 "$output"
  test "$status" != '0' || fail "$event probe unexpectedly succeeded"
  grep -Fq "$guard_marker" "$output" || fail "$event probe did not fail through the guard"
}

test "$(id -u)" = '0' || fail 'not root'
test "$(stat -c '%a' "$evidence_dir")" = '700' || fail 'evidence directory must be mode 0700'
test -f "$evidence_dir/typecho-before.sql.gz" || fail 'Typecho backup missing'
test -f "$evidence_dir/waline-before.sql.gz" || fail 'Waline backup missing'
gzip -t "$evidence_dir/typecho-before.sql.gz"
gzip -t "$evidence_dir/waline-before.sql.gz"
test "$(tr -d '\r\n' < "$www_root/state/redirect-status")" = '302' || fail 'redirect status drifted'
test "$(tr -d '\r\n' < "$www_root/state/comment-write-mode")" = 'disabled' || fail 'comment mode drifted'
test "$(docker inspect --format '{{.State.Running}}' "$typecho_container")" = 'true' || fail 'Typecho is not running'
test "$(docker port "$typecho_container" 80/tcp)" = '127.0.0.1:8080' || fail 'Typecho loopback binding drifted'
test "$(docker exec "$mysql_container" sh -lc 'mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=\"typecho_frf6hh\" AND TABLE_NAME IN (\"typecho_comments\",\"typecho_contents\")"' 2>/dev/null)" = '2' || fail 'Typecho target tables missing'

existing_guard_count="$(docker exec "$mysql_container" sh -lc 'mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=\"typecho_frf6hh\" AND TRIGGER_NAME IN (\"astro_stage10_typecho_comments_no_insert\",\"astro_stage10_typecho_comments_no_update\",\"astro_stage10_typecho_comments_no_delete\")"' 2>/dev/null)"
test "$existing_guard_count" = '0' || fail 'one or more Stage 10 guard triggers already exist'

comment_state > "$evidence_dir/typecho-comment-state.before.txt"
chmod 600 "$evidence_dir/typecho-comment-state.before.txt"

printf "CREATE TRIGGER \`%s\` BEFORE INSERT ON \`%s\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='%s';\n" \
  "$insert_trigger" "$comments_table" "$guard_marker" | mysql_root >/dev/null 2>&1
created_insert='true'
printf "CREATE TRIGGER \`%s\` BEFORE UPDATE ON \`%s\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='%s';\n" \
  "$update_trigger" "$comments_table" "$guard_marker" | mysql_root >/dev/null 2>&1
created_update='true'
printf "CREATE TRIGGER \`%s\` BEFORE DELETE ON \`%s\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='%s';\n" \
  "$delete_trigger" "$comments_table" "$guard_marker" | mysql_root >/dev/null 2>&1
created_delete='true'

docker exec "$mysql_container" sh -lc 'mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,SHA2(ACTION_STATEMENT,256) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=\"typecho_frf6hh\" AND EVENT_OBJECT_TABLE=\"typecho_comments\" AND TRIGGER_NAME IN (\"astro_stage10_typecho_comments_no_insert\",\"astro_stage10_typecho_comments_no_update\",\"astro_stage10_typecho_comments_no_delete\") ORDER BY EVENT_MANIPULATION"' \
  > "$evidence_dir/typecho-comment-guard.txt" 2>/dev/null
chmod 600 "$evidence_dir/typecho-comment-guard.txt"
test "$(wc -l < "$evidence_dir/typecho-comment-guard.txt" | tr -d ' ')" = '3' || fail 'guard trigger metadata count mismatch'
grep -Fq $'astro_stage10_typecho_comments_no_insert\tINSERT\tBEFORE\t' "$evidence_dir/typecho-comment-guard.txt" || fail 'INSERT guard metadata mismatch'
grep -Fq $'astro_stage10_typecho_comments_no_update\tUPDATE\tBEFORE\t' "$evidence_dir/typecho-comment-guard.txt" || fail 'UPDATE guard metadata mismatch'
grep -Fq $'astro_stage10_typecho_comments_no_delete\tDELETE\tBEFORE\t' "$evidence_dir/typecho-comment-guard.txt" || fail 'DELETE guard metadata mismatch'

expect_blocked 'INSERT' 'INSERT INTO typecho_comments SELECT * FROM typecho_comments ORDER BY coid LIMIT 1;'
expect_blocked 'UPDATE' 'UPDATE typecho_comments SET text=text ORDER BY coid LIMIT 1;'
expect_blocked 'DELETE' 'DELETE FROM typecho_comments ORDER BY coid LIMIT 1;'

comment_state > "$evidence_dir/typecho-comment-state.after.txt"
chmod 600 "$evidence_dir/typecho-comment-state.after.txt"
cmp -s "$evidence_dir/typecho-comment-state.before.txt" "$evidence_dir/typecho-comment-state.after.txt" || fail 'Typecho comment/content state changed while installing guard'

{
  printf 'utc='; date -u '+%Y-%m-%dT%H:%M:%SZ'
  printf 'database=%s\ncomments_table=%s\n' "$database" "$comments_table"
  printf 'guard_events=INSERT,UPDATE,DELETE\nwrite_probes_blocked=true\n'
  printf 'typecho_container_restarted=false\nallowComment_unchanged=true\n'
  printf 'redirect_status=302\ncomment_write_mode=disabled\n'
  printf 'guard_persistence=permanent_after_comment_cutover\n'
} > "$evidence_dir/stop-write-summary.txt"
chmod 600 "$evidence_dir/stop-write-summary.txt"
sha256sum \
  "$evidence_dir/typecho-comment-state.before.txt" \
  "$evidence_dir/typecho-comment-state.after.txt" \
  "$evidence_dir/typecho-comment-guard.txt" \
  "$evidence_dir/guard-insert-probe.txt" \
  "$evidence_dir/guard-update-probe.txt" \
  "$evidence_dir/guard-delete-probe.txt" \
  "$evidence_dir/stop-write-summary.txt" \
  > "$evidence_dir/SHA256SUMS.stop-write"
chmod 600 "$evidence_dir/SHA256SUMS.stop-write"

created_insert='false'
created_update='false'
created_delete='false'
trap - EXIT
cat "$evidence_dir/stop-write-summary.txt"
printf 'TYPECHO_COMMENT_GUARD_OK\n'
