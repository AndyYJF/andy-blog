# Stage 10 — 生产验收与切换

## 2026-08-09 CMS/comment management execution status

- Phase 12 (AA-06 editor/automatic publish package): completed and deployed.
- Phase 13 (production Waline management entry/boundary): completed and deployed.
- Phase 14 (1Panel deploy/rollback package): completed.
- Phase 15 (production deployment): completed; current release `20260809T123758Z-f7d863f2`.
- Production invariant remains `302 + comment-write-mode=enabled`; 301 is prohibited.
- This status block supersedes the stale Phase 12-15 rows later in this historical table.
- Immediate operational follow-up is scoped Docker disk reclamation planning: root is `97%` used, and rollback images/releases must be identified before any prune.
- Phase 16 (comments admin API-origin repair): completed; comments-domain HTTP Basic removed, Waline login retained, registration POSTs permanently rejected, and other unauthenticated API writes denied.
- Phase 17 (production comment moderation): completed; production Waline runs healthy with `COMMENT_AUDIT=true`, so new comments require approval before display.
- Phase 10c (decoded legacy mapping repair): local implementation and gates completed in `8f33989`; production deployment remains separately authorized and pending.
- Phase 10d (real dual-CDN purge): local implementation completed; credentialed execution and post-propagation evidence remain a separately authorized production step.
- Phase 10e (cleanup): local Codex temporary scripts were removed; VPS cleanup remains inventory-first because root usage was last observed at 97%.
- Phase 10e read-only inventory now proves releases are not the capacity cause; detailed image/volume ownership and the installed CMS systemd unit names still need identification before any cleanup or runtime claim.

## Goal

按 `docs/plan.md` §8.5 / 阶段 10：在 `new` 全量验收后，将生产 `www` 切到静态 Astro（先 302、`commentWriteMode=disabled`），完成评论停写对账后启用 Waline，观察 ≥7 天再切 301；全程可回滚。

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | 盘点缺口 + 建 Stage 10 脚手架（本机） | completed |
| 2 | 回滚 / roll-forward / 状态跃迁脚本 | completed |
| 3 | 1Panel www 切流 adapter + prod Waline compose | completed |
| 4 | Stage 10 gate + cutover runbook | completed |
| 5 | 本机 gate 验收；记录 VPS 实操阻塞项 | completed |
| 6 | （需授权）VPS 实切 www — 首次 302/comments-disabled | completed |
| 7 | 评论停写 / 迁移 / 对账方案与生产缺口盘点（本机） | completed |
| 8a | （已授权）VPS 只读 preflight：拓扑、release/state、schema 识别 | completed |
| 8 | 补齐并验证生产 MySQL 迁移 / 对账工具（本机） | completed |
| 8b | （已授权）production Waline readiness：备份/schema/healthcheck/GET | completed |
| 9a | Phase 9 停写/固定导出/迁移执行包与授权边界（本机） | completed |
| 9b | （已授权）VPS 评论停写、迁移 apply 与零差异对账 | completed |
| 9c | （已完成）comment-write-mode enabled 独立 release | completed |
| 9c-prep | Phase 9c 授权包、fail-closed runner 与回滚/验收门禁（本机） | completed |
| 10 | 302 观察窗清单与证据模板（至少至 2026-08-12） | completed |
| 10b | 公网只读观察采集器与每日样本（2026-08-10 续采） | completed |
| 10c | decoded legacy mapping 修复与 302-only 生产部署包 | completed |
| 10d | Aliyun / Cloudflare 真实 purge 实现与 fail-closed 门禁 | completed |
| 10e | 本机临时文件清理与 VPS 空间回收清单 | in_progress |
| 11 | 301 独立 release（观察窗满足前禁止执行） | pending |
| 12 | AA-06 文章编辑后台与自动发布链本地收口 | in_progress |
| 13 | 生产 Waline 评论管理入口与权限边界本地收口 | pending |
| 14 | 1Panel 部署包、回滚和一次性生产授权文本 | pending |
| 15 | （需新授权）部署 cms/评论管理/自动发布纵向 | pending |

## Success criteria (plan)

- 内容/关系/路由全量差异为 0
- legacy/action 三视角按记录状态 100% 通过
- RSS fixture 无旧文刷屏
- 评论最终对账为 0；启用前全局 POST=403；启用后仅开放 key 可写
- release / action-map / sitemap / 部署状态版本一致
- 回滚覆盖 release、map、双 CDN、评论去向

## Current constraints

- 不启动仓库 `compose.yml` 的 Nginx；生产 80/443 由 1Panel OpenResty 管理。
- 不在普通 rebuild 中修改 `redirect-status` 或 `comment-write-mode`；状态只能由 `transition-deploy-state.sh` 跃迁并打独立 release。
- 2026-08-09 Phase 9b 已完成；Typecho 评论表永久只读，CID 47 已关闭，生产 Waline 已迁入 2 条评论并完成独立第二次零变更对账。
- 当前阶段禁止切 301；观察窗至少到 2026-08-12，且仍需 legacy/action 与双 CDN 证据。
- Phase 9c 与 10c 已完成：生产 `current` 为 `20260811T060917Z-408488e5`，保持 302，`comment-write-mode=enabled`；`previous` 为 `20260809T123758Z-f7d863f2`，decoded legacy mapping origin 验证为单跳 302。
- 2026-08-09 owner 已授权 Phase 8b：仅 production `waline` 备份、reviewed schema、生产 Waline healthcheck/必要单容器重建、只读 GET/状态验证；排除 Typecho 停写/迁移 apply/评论启用/OpenResty/release/purge/301。
- 2026-08-09 owner 已追加窄授权：仅将既有 `waline`@`%` 以原密码切换为 `mysql_native_password`；不改 grants、不打印或落盘密码、不重启 MySQL；known-key GET 非 200 时自动恢复 `caching_sha2_password`。成功后仅继续既有 Phase 8b healthcheck 与 production Waline 单容器重建授权。
- 2026-08-09 owner 已确认 `/posts/typecho-joe-mermaid/`（CID 47）为真实 closed key，并授权 Phase 9b：备份 Typecho/production Waline、仅 CID 47 `allowComment=0`、永久评论表只读 guard、双快照、dry-run，干净后 apply/按需 scoped sweep/双遍零差异对账。排除评论启用、release/OpenResty、staging、POST、purge、301。
- Phase 9c-prep 只在本地形成执行包；未获得新的 owner 授权前，不运行 state transition、rebuild/switch、生产 POST、OpenResty reload、purge 或 301。
- Phase 9c-prep 已完成：candidate builder 在构建前后均要求完整 clean worktree，release validator 固定 302/enabled/唯一 closed key，1Panel runner 具备备份、原子切换、三类 POST 验收与 disabled-release 自动回滚；其后 owner 已单独授权 Phase 9c。
- 2026-08-09 owner 已按授权包原文批准 Phase 9c：302 + enabled 独立 release、生产 Waline 备份、受控状态跃迁/原子切换、closed/unknown 两次拒绝 POST、open key 一次保留标记 POST及失败自动回 disabled release；301、purge、OpenResty、staging、容器重启、删除/恢复继续排除。
- 下一步是单独授权的真实 Aliyun/Cloudflare exact-URL purge 与传播后三视角验证；当前 public legacy仍为旧CDN 200且`edge-status=edge-pending`。301 在至少 2026-08-12 且 legacy/action/双 CDN 证据干净前继续禁止。
- CMS/评论管理本地开发可与 302 观察并行；生产部署必须继承当前 302/enabled，不得启动仓库 Nginx，不得把 staging Waline 并入生产。
