# Stage 10 — production www cutover (host runbook)

Follow `docs/plan.md` §8.5. Do **not** skip the observation window or invent `301` /
`commentWriteMode=enabled` inside ordinary rebuild jobs.

Detailed continuation documents:

- `stage10-comment-cutover-plan.md` — production stop-write, full migration,
  reconciliation, enable, and authorization boundaries.
- `stage10-302-observation-window.md` — daily 302 evidence checklist and 301
  blockers; it does not authorize a 301 transition.
- `stage10-vps-readonly-preflight-2026-08-09.md` — sanitized live topology,
  schema, comment-read, rollback, and legacy-cache evidence.
- `stage10-production-waline-readiness-authorization.md` — proposed bounded
  schema/read-health repair; status is awaiting owner authorization.

## Prerequisites

1. Stage 9 `new.andy-y.cn` still healthy (or archived with known-good release).
2. In-repo `npm run stage10:gate` PASS.
3. Digest-pinned images + production Waline MySQL schema (`waline`, not staging).
4. Lower DNS TTL for `www` / apex before cut day.
5. Disk headroom + TLS renewal check (wildcard currently managed by 1Panel).
6. Backup Typecho DB + files; confirm rollback targets exist.

## Order (fail closed)

### A. Pre-cut static release (302 + comments disabled)

```bash
export WWW_ROOT=/www/sites/www.andy-y.cn/deploy   # adjust to live path
export COMPOSE_DIR=/path/to/andy-blog
export STATE_DIR=$WWW_ROOT/state

mkdir -p "$STATE_DIR"
printf '302\n' >"$STATE_DIR/redirect-status"
printf 'disabled\n' >"$STATE_DIR/comment-write-mode"

# Build release that embeds redirectStatus=302 and commentWriteMode=disabled,
# then place under $WWW_ROOT/releases/<id> with site/ nginx/ policies / manifest.
```

Generate 1Panel www vhost from that release’s maps:

```bash
node scripts/generate-www-cutover-http.js --status 302 --out .cache/stage10-nginx/www-cutover-http.conf
node scripts/generate-1panel-www-nginx.js \
  --input .cache/stage10-nginx/www-cutover-http.conf \
  --out .cache/stage10-nginx/www.andy-y.cn.conf
# Install into OpenResty conf.d AFTER backing up the Typecho reverse-proxy vhost.
```

Start production Waline (loopback only):

```bash
docker compose -f compose.1panel-production.yml up -d
curl -fsS \
  -H 'Origin: https://www.andy-y.cn' \
  -H 'Referer: https://www.andy-y.cn/' \
  'http://127.0.0.1:8360/api/comment?path=%2Fposts%2Ftypecho-joe-mermaid%2F' \
  >/dev/null
```

Atomic point `current` at the release (relative symlink). Reload OpenResty.
Smoke:

```bash
curl -fsS https://www.andy-y.cn/__release
curl -fsSI https://www.andy-y.cn/ | head
# admin/php must 404 on www
curl -fsSI https://www.andy-y.cn/admin/ | head
# comments: POST must 403 while disabled
bash host/comment-stop-write-checklist.sh
```

### B. Comment stop-write → enable (separate release)

1. Close Typecho comment writes; drain in-flight.
2. Final idempotent migrate + parent-graph reconcile = 0.
3. `bash host/transition-deploy-state.sh comment-write-mode enabled`
4. Rebuild+switch a release that embeds `enabled`.
5. Verify only open keys accept POST.

### C. 302 observation ≥7 days → 301 (separate release)

1. Clear legacy/action errors across origin + dual CDN probes.
2. `bash host/transition-deploy-state.sh redirect-status 301`
3. Rebuild+switch with `--status 301` / `REDIRECT_STATUS=301`.
4. Purge dual CDN (must not fake ok); verify HTML hash agreement.

### D. Rollback / roll-forward drills

```bash
bash host/rollback-release.sh          # current ↔ previous + state from manifest
bash host/roll-forward-release.sh      # undo rollback
```

After comment enable, Typecho comments stay read-only forever per plan.

## Production continuation record — 2026-08-09

Phase 9c completed with immutable release `20260809T102318Z-1db1021e`.
Production remains on redirect 302 and now has `commentWriteMode=enabled`;
`previous` points to disabled release `20260805T143100Z-c92e7d31`. CID 47 is
the sole closed key, while the retained open-key probe is the only native
Waline comment. Continue the observation checklist and do not create a 301
release before the separately authorized post-window transition.

## SEO follow-ups (not instant gates)

- Submit sitemap / 百度改版
- 48h watch; day 7 / 30 / 90 SEO review
- `site:` rankings are not cutover blockers
