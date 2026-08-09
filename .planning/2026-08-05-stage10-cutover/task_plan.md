# Stage 10 — 生产验收与切换

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
| 9 | （需授权）VPS 评论停写、迁移、零差异对账与独立启用 release | pending |
| 10 | 302 观察窗清单与证据模板（至少至 2026-08-12） | completed |
| 11 | 301 独立 release（观察窗满足前禁止执行） | pending |

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
- 2026-08-09 已授权对 `root@139.224.71.200` 执行只读 preflight；不包含停写、备份、迁移、SQL 写入、状态跃迁、release 切换、POST、purge 或 301。
- 当前阶段禁止切 301；观察窗至少到 2026-08-12，且仍需 legacy/action 与双 CDN 证据。
- Phase 8 本地迁移工具尚未对生产评论执行 dry-run/apply；Phase 8b readiness 已在真实 MySQL/VPS Compose 完成。下一步 Phase 9 的 Typecho 停写、固定导出、迁移与启用仍需单独授权。
- 2026-08-09 owner 已授权 Phase 8b：仅 production `waline` 备份、reviewed schema、生产 Waline healthcheck/必要单容器重建、只读 GET/状态验证；排除 Typecho 停写/迁移 apply/评论启用/OpenResty/release/purge/301。
- 2026-08-09 owner 已追加窄授权：仅将既有 `waline`@`%` 以原密码切换为 `mysql_native_password`；不改 grants、不打印或落盘密码、不重启 MySQL；known-key GET 非 200 时自动恢复 `caching_sha2_password`。成功后仅继续既有 Phase 8b healthcheck 与 production Waline 单容器重建授权。
