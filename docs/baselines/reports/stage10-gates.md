# Stage 10 gates

**Result:** PASS (in-repo cutover scaffold)

- rollback-release.sh / roll-forward-release.sh (manifest state sync)
- transition-deploy-state.sh (302↔301, comment disabled↔enabled + audit descriptors)
- generate-www-cutover-http.js + generate-1panel-www-nginx.js
- compose.1panel-production.yml (Waline loopback 8360)
- comment-stop-write-checklist.sh
- production MySQL migration backend (dry-run default, named lock, transaction, twice + zero-diff reconciliation)
- guard-protected Typecho fixed exporter + permanent comment-table readonly guard
- stage10-www-cutover.md runbook (§8.5 order)
- CDN purge is exact-URL and fail-closed; real provider IDs plus a post-propagation matrix are still required

## Accepted debt (live VPS / secrets — not Stage 10 scaffold blockers)

- Separate comment-enable release remains pending owner authorization
- Observation evidence still has public-CDN legacy 200 versus origin 302
- Real Aliyun / Cloudflare purge OpenAPI wiring
- cms.andy-y.cn vertical on 1Panel (AA-06)
- 7-day 302 observation then authorized 301 transition

## Warnings

(none)

## Failures

(none)
