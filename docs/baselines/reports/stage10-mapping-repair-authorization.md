# Stage 10 decoded legacy mapping repair authorization

**Status:** `PAUSED_RUNNER_FIX_REQUIRES_REAUTH`

The owner authorized commit `6dc4e3a`, but its read-only production preflight
proved that `docker compose images -q builder` cannot discover a build-profile
service used only through `run --rm`, and that the initial `edge-status` file is
absent. No production write occurred under that authorization. The corrected
commit uses the unique `andy-blog-cms-builder` ref from `config --images` and
restores an initially absent edge-state file on failure; execution requires the
owner to bind authorization to the corrected commit.

This packet is for one dedicated 1Panel production transaction. It repairs the
decoded request form of `/index.php/tag/%E5%88%86%E6%9E%90fen-x/` while keeping
the site at redirect `302` and comment write mode `enabled`.

## Bound production facts

- SSH target: `root@139.224.71.200` with the dedicated Stage 10 key.
- Current release before the transaction: `20260809T123758Z-f7d863f2`.
- Current vhost SHA-256: `6e9a8b54e381c78714709f4e531c38fe5be428be695f8a01e3afc25bca099d3e`.
- OpenResty container: `1Panel-openresty-yR6x`.
- OpenResty image ID: `sha256:5658572d544acf3c3451802a161db87956770dd2454751c7c1500091c7c5b1ea`.
- Required state: `redirect-status=302`, `comment-write-mode=enabled`, and
  `blog-rebuild-1panel.path` active.

All of these values are fail-closed preconditions. Any drift stops before the
first production change. The reviewed source commit and source archive SHA-256
must be recorded immediately before execution.

## Authorized transaction to request

1. Reconfirm the exact current release, vhost hash, OpenResty identity, state,
   watcher, disk space, and that the old builder image below has no container
   references.
2. If build space is insufficient, remove only unused image
   `sha256:22d68ae100bfd6413110dda5c78667b8339e7a15214a93e94c01c44071b1efe3`.
   Do not run `docker system prune`, `docker image prune`, volume prune, or
   build-cache prune.
3. Back up the deployed source manifest and active www vhost; install the exact
   reviewed source overlay in `/var/www/andy-blog` and write its 40-hex revision
   to root-owned `.deploy-source-revision`.
4. Stop `blog-rebuild-1panel.path` only for the transaction; build only the
   `builder` image with the reviewed revision label; create a fresh immutable
   `302 + enabled` release from a read-only Typecho snapshot.
5. Generate the candidate 1Panel www vhost and require a byte-for-byte diff
   containing only the single encoded-to-decoded mapping replacement.
6. Back up and atomically install the candidate vhost, run OpenResty config
   test, switch `current`/`previous`, reload the existing 1Panel OpenResty
   container, and verify the release marker, legacy 302 target, `/admin/` 404,
   Waline GET 200, and unchanged `302 + enabled` state.
7. Record `last-success-release`, set `edge-status=edge-pending`, and restart the
   rebuild watcher. CDN purge remains a separate transaction.

On any failure, restore `current`, `previous`, `last-success-release`,
`edge-status`, and the active vhost; test/reload restored OpenResty and restart
the watcher. Preserve the failed candidate, new release, and timestamped backup
as evidence until separately reviewed.

## Explicit exclusions

- no `301` and no redirect/comment state transition;
- no CDN API call or CDN purge;
- no comment POST, deletion, migration, moderation, or database restore;
- no staging read/write/restart or production Typecho/MySQL/Waline restart;
- no repository nginx and no OpenResty container restart;
- no global Docker prune, volume deletion, release deletion, backup deletion,
  or removal of Waline rollback images;
- never remove dangling image
  `sha256:76c326b05dc313eb8268a907f4bf593c9bfd12cef39234ff57097021c6e0e7c5`,
  because it is used by `easytier-easytier-1`.

## Required owner authorization wording

> 授权使用 root@139.224.71.200 执行 Stage 10 decoded mapping repair：按已提交
> source commit 和 archive SHA 部署 source overlay；在再次确认无容器引用后，
> 如空间不足仅删除文档列明的旧 builder image；构建并原子切换一个保持
> 302+enabled 的独立 release；仅允许一行 decoded legacy mapping vhost 变更、
> OpenResty test/reload、只读 GET/状态验证；失败时恢复 vhost、release symlink、
> state 与 watcher。授权不包含 301、CDN purge、POST、评论/数据库操作、staging、
> Typecho/MySQL/Waline/OpenResty 容器重启、全局 Docker prune 或其他删除。
