# Progress — Stage 10

- 2026-08-05：启动 Stage 10；按 plan §8.5 先做 in-repo 脚手架，不擅自切 www DNS。
- 2026-08-05：落地 `rollback-release.sh` / `roll-forward-release.sh` / `transition-deploy-state.sh`（Node 写状态，兼容本机无 python3）。
- 2026-08-05：落地 `generate-www-cutover-http.js` + `generate-1panel-www-nginx.js` + `compose.1panel-production.yml`。
- 2026-08-05：落地 `comment-stop-write-checklist.sh`、`stage10-www-cutover.md`、`stage10-gate.js`；`cdn-purge.sh` 改为 Node 写 job 且仍 fail-closed。
- 2026-08-05：`npm run stage10:gate` → PASS。VPS 实切 www / 评论迁移 / 真实 CDN purge 仍待授权。
