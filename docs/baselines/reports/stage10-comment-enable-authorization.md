# Stage 10 Phase 9c — production comment enable authorization

**Status:** `PHASE9C_COMPLETE`

Phase 9b is complete. This packet is the next separate production window from
`docs/plan.md` §8.5 step 3. It enables production Waline writes with a new
immutable release while retaining redirect 302 and the permanent Typecho
comment-table guard.

## Preconditions

- Current production release is exactly `20260805T143100Z-c92e7d31` with
  `redirect-status=302` and `comment-write-mode=disabled`.
- CID 47 is the sole closed content row and remains `allowComment=0`.
- The three permanent Typecho comment guards are present; source comments stay
  at 2 rows.
- Production Waline is healthy with 2 Typecho mappings and 2 mapped comments;
  Phase 9b reconciliation is zero-difference.
- The candidate is built from a clean committed HEAD and a fresh read-only
  Typecho snapshot. Its policy must contain 15 keys: 14 writable and only
  `/posts/typecho-joe-mermaid/` closed.
- Candidate Nginx maps must be byte-identical to the current release. Any map
  change stops this window because OpenResty reload is outside this scope.

## Proposed authorized actions

1. In an isolated checkout, use
   `scripts/build-1panel-comment-enable-release.sh` to produce a reviewed
   `redirectStatus=302`, `commentWriteMode=enabled` immutable archive. Typecho
   access is read-only; credentials stay in process environment and are not
   placed in the archive or repository.
2. Upload only that archive and execute the reviewed
   `host/enable-production-comments-1panel.sh` against
   `root@139.224.71.200` with the exact archive/release/source hashes.
3. Create a new root-only evidence directory and back up production Waline
   before the first comment write. Verify gzip and SHA-256.
4. Validate and preinstall the immutable release while production remains
   disabled. Then invoke the packaged, reviewed
   `transition-deploy-state.sh comment-write-mode enabled` and atomically set
   `current` to the candidate and `previous` to the former current release.
5. Do not reload 1Panel OpenResty: the active vhost already follows `current`,
   and the runner requires the candidate Nginx map to be byte-identical.
6. Through the production origin path, submit valid payloads to the selected
   closed key and an unknown key; require 403 `entry-not-writable` and 403
   `unknown-key`, with no Waline row changes.
7. Submit exactly one clearly labelled native test comment to the open key
   `/posts/stable-diffusion-notes-p1/`. Require HTTP 200, exactly one unique
   marker row, 2 unchanged Typecho mappings, and final counts of 3 Waline
   comments / 1 native comment. Preserve this labelled native row as the
   runtime enable evidence; do not silently delete it.
8. Verify release/manifest/state agreement, historical GET=200, Typecho still
   has 2 comments and 3 guards, and `previous` is a valid rollback target.
9. Stop. Record +15 minute and +24 hour read-only guard/count checks separately.

## Automatic failure behavior

After the state transition, any switch or runtime validation failure restores
`current` to the former disabled release and invokes
`transition-deploy-state.sh comment-write-mode disabled`. The failed candidate
remains immutable for diagnosis and `previous` points to it for controlled
roll-forward. If the open-key POST already committed, its labelled native row
may remain; rollback pauses new writes but does not delete post-enable Waline
comments.

## Explicit exclusions

- no redirect-status transition and no 301;
- no CDN purge, DNS change, sitemap submission, or SEO action;
- no OpenResty configuration write/reload and no repository nginx container;
- no Typecho/MySQL/Waline container restart and no Typecho comment-guard removal;
- no staging database/container/site read, write, restart, merge, or migration;
- no comment deletion, database restore, destructive cleanup, or unlabelled
  production test comment;
- no application/content change other than the single retained labelled probe
  comment created through the newly enabled open key.

Owner authorization must explicitly cover the state transition, immutable
release install/switch, production Waline backup, two denied POST probes, one
retained open-key POST, and automatic disabled-release rollback. It does not
authorize any excluded item above.

## Execution result — 2026-08-09

- Active release: `20260809T102318Z-1db1021e`; source HEAD
  `3a515147e215bca51724972742f7e9cc11febdd2`; archive SHA-256
  `71ad14c2128b1d71e54077fc888256ce2c47531b42d5a490b6ee8723cbbd60aa`.
- Deployment state: `redirect-status=302`, `comment-write-mode=enabled`;
  `previous` is the former disabled release `20260805T143100Z-c92e7d31`.
- Probe evidence: closed key 403 `entry-not-writable`, unknown key 403
  `unknown-key`, open key 200 with exactly one retained marker row. The first
  transport attempt automatically rolled back after all three probes; the
  exact-resume run reused their evidence and did not send duplicate POSTs.
- Final invariants: Typecho/Waline/mapping counts `2/3/2`, Typecho guards `3`,
  CID 47 `allowComment=0`, production Waline healthy and known-key GET 200.
- Evidence: `/root/stage10-comments/20260809T102424Z-phase9c` and
  `/root/stage10-comments/20260809T102756Z-phase9c-resume`.
- No OpenResty reload, CDN purge, staging operation, container restart, comment
  deletion/database restore, or redirect transition was performed. 301 remains
  prohibited during the observation window.

## Requested authorization text

> 授权使用 `root@139.224.71.200` 执行 Stage 10 Phase 9c：从已提交的干净 HEAD
> 构建并上传经校验的 302 + Waline enabled 不可变 release；备份生产 Waline；用
> `transition-deploy-state.sh` 将 comment-write-mode 改为 enabled 并原子切换
> `current/previous`；对关闭 key 和未知 key 各执行一次必须为 403 的 POST，并对
> `/posts/stable-diffusion-notes-p1/` 执行一次保留的标记评论 POST；执行只读状态、
> 计数和 GET 核验；失败时自动恢复原 disabled release。授权不包含 301、CDN
> purge、OpenResty 配置或 reload、staging、容器重启、Typecho guard 移除、评论删除
> 或数据库恢复。

## Owner authorization record

On 2026-08-09 the owner supplied the requested authorization text verbatim.
The authorized production window is therefore limited to the actions above;
all explicit exclusions remain binding.
