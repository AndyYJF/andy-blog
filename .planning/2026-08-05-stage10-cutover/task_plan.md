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
| 6 | （需授权）VPS 实切 www — 不在无授权时执行 | pending |

## Success criteria (plan)

- 内容/关系/路由全量差异为 0
- legacy/action 三视角按记录状态 100% 通过
- RSS fixture 无旧文刷屏
- 评论最终对账为 0；启用前全局 POST=403；启用后仅开放 key 可写
- release / action-map / sitemap / 部署状态版本一致
- 回滚覆盖 release、map、双 CDN、评论去向
