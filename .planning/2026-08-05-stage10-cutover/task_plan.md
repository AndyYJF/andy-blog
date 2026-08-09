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
| 9a | Phase 9 停写/固定导出/迁移执行包与授权边界（本机） | completed |
| 9b | （已授权）VPS 评论停写、迁移 apply 与零差异对账 | completed |
| 9c | （再授权）comment-write-mode enabled 独立 release | pending |
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
- 2026-08-09 Phase 9b 已完成；Typecho 评论表永久只读，CID 47 已关闭，生产 Waline 已迁入 2 条评论并完成独立第二次零变更对账。
- 当前阶段禁止切 301；观察窗至少到 2026-08-12，且仍需 legacy/action 与双 CDN 证据。
- 下一步 Phase 9c 仍需单独授权：只通过 `transition-deploy-state.sh` 生成 `comment-write-mode=enabled` 的独立 release；不得与 301、OpenResty 或 CDN purge 合并。
- 2026-08-09 owner 已授权 Phase 8b：仅 production `waline` 备份、reviewed schema、生产 Waline healthcheck/必要单容器重建、只读 GET/状态验证；排除 Typecho 停写/迁移 apply/评论启用/OpenResty/release/purge/301。
- 2026-08-09 owner 已追加窄授权：仅将既有 `waline`@`%` 以原密码切换为 `mysql_native_password`；不改 grants、不打印或落盘密码、不重启 MySQL；known-key GET 非 200 时自动恢复 `caching_sha2_password`。成功后仅继续既有 Phase 8b healthcheck 与 production Waline 单容器重建授权。
- 2026-08-09 owner 已确认 `/posts/typecho-joe-mermaid/`（CID 47）为真实 closed key，并授权 Phase 9b：备份 Typecho/production Waline、仅 CID 47 `allowComment=0`、永久评论表只读 guard、双快照、dry-run，干净后 apply/按需 scoped sweep/双遍零差异对账。排除评论启用、release/OpenResty、staging、POST、purge、301。
