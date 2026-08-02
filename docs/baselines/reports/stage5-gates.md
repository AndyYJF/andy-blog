# Stage 5 gates

Date: 2026-08-02

## Delivered

### 1. Editor

- **Decision: Joe theme as CMS-only editor** (XEditor spike skipped — see `stage5-editor-decision.md`)
- `typecho/config.cms-constants.php.example` — `__TYPECHO_PLUGIN_URL__` / `__TYPECHO_THEME_URL__` on `cms.andy-y.cn`
- `patches/typecho-1.2.1/admin-origin.patch` + `file-hashes.json` (Permalink / Profile / Login)
- `scripts/typecho-siteurl-allowlist.js` — CI allowlist for remaining `siteUrl` references

### 2. AutoRebuild + rebuild-api

- `typecho/usr/plugins/AutoRebuild/Plugin.php` — `finishPublish` / `mark` / `finishDelete` → HMAC → `http://rebuild-api:9000/hooks/rebuild`
- `docker/rebuild-api/` — Node 22 service: raw-body HMAC, ± skew ±5m, nonce replay store, body cap, durable `pending` / `dirty`, spool markers
- Unit tests: bad sig / skew / replay / dirty-while-building → `docker/rebuild-api/test.js`

### 3. Control plane

- `scripts/build-release.sh` — flock, staging dir, checksums, stdout = one release ID
- `scripts/generate-comment-policy.js` / `finalize-manifest.js` / `generate-candidate-nginx.js` / `read-db-epoch.js`
- `host/blog-rebuild.sh` — debounce, job descriptor with fixed `SNAPSHOT_EPOCH`, compose run builder, switch, CDN, Baidu
- `host/switch-release.sh` — `nginx -t -c candidate`, relative `current`/`previous` swap, origin `/__release` check + rollback
- `host/systemd/blog-rebuild.{path,service}` + `blog-reconcile.{timer,service}` (5-minute catch-up)

### 4. Dual CDN + Baidu

- `host/cdn-purge.sh` — durable per-release job; with credentials records `not-implemented` and fails (never stub `ok`)
- `host/baidu-push.sh` — **diff-only** vs previous release id passed as `$2` (captured before `last-success-release` overwrite); post URLs are canonical `https://www.andy-y.cn/posts/<slug>/` (no `//`)
- Behavior fixture: `bash scripts/test-baidu-push.sh` (wired into `stage5-gate.js`)

### 5. Compose scaffold

- `compose.yml` — typecho / nginx / rebuild-api / builder
- CMS PHP upstream: `fastcgi_pass typecho:9000` (Compose DNS)
- **Neither rebuild-api nor builder mounts `docker.sock`**
- `typecho/` volume is plugin/config scaffold — full CMS tree not shipped in-repo

## Local gate results

```text
node scripts/stage5-gate.js
```

| Check | Result |
|---|---|
| Patch `git apply --check` | PASS |
| rebuild-api HMAC/replay/dirty tests | PASS |
| comment-policy + manifest + candidate nginx dry-run | PASS |
| compose has no docker.sock | PASS |
| siteUrl allowlist on Typecho 1.2.1 tree | PASS |

## Not yet runnable on this laptop

End-to-end CMS login / Joe asset 200s / live `nginx -t -c` / dual-CDN purge need the production VPS + secrets. Those remain Stage 9/10 acceptance items; Stage 5 ships the code and local unit gates.

## Commands

```powershell
node docker/rebuild-api/test.js
node scripts/stage5-gate.js
# On the server (after secrets + WWW_ROOT):
# docker compose up -d typecho nginx rebuild-api
# systemctl enable --now blog-rebuild.path blog-reconcile.timer
```
