# Stage 9 gates

**Result:** PASS (in-repo deploy scaffold)

- compose.yml + compose.staging.yml + staging-loader
- compose.1panel-staging.yml + generated 1Panel OpenResty adapter
- staging-http.conf with independent `$staging_*` maps and new.andy-y.cn → waline-staging
- OnFailure alert units + fail-closed alert-notify (exit 71)
- cert-new-andy-y.sh + staging enable runbook
- Lighthouse budgets (Perf≥95, SEO 100, A11y≥95) via `lighthouse:local` / gate
- BEOE mermaid `alt` via `scripts/patch-beoe-alt.js` (post-pagefind)
- dual-CDN probe script (live optional)

## Accepted debt (not Stage 9 scaffold blockers)

- AA-02 human Final: closed 15/15 (`owner-final-accept`, 2026-08-05)
- AA-06 full CMS vertical / AA-09 Stage0 restore evidence / AA-10 mutations
- Live VPS `nginx -t`, cert issue, rollback drill — require production-write authorization
- Real CDN purge OpenAPI still `not-implemented` (exit 71)
- Re-run compose config on a host with Docker CLI when this machine lacks `docker`

## Warnings

- docker compose base config skipped: spawnSync docker ENOENT
- docker compose staging config skipped: spawnSync docker ENOENT
- SKIP_LIGHTHOUSE=1 — lighthouse autorun skipped
- dual-CDN live probe skipped (set SKIP_CDN_PROBE=0 to run against www)

## Failures

(none)
