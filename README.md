# andy-blog

Typecho 1.2.1 (headless CMS) → Astro 7 static site for andy-y.cn.

## Stage 0

**Status: baselines + Astro spike complete (2026-08-01).**

- Evidence: `docs/baselines/` (SQL gates, RSS fixture, URL crawl, reports)
- Dump / article bodies / uploads: `backups/` (gitignored)
- Spike notes: `docs/baselines/reports/astro-spike.md`

## Stage 1

**Status: sync + immutable routes + content collections complete.**

```powershell
$env:SNAPSHOT_EPOCH = "1785565762"
npm run sync
node scripts/stage1-gate.js
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm --prefix astro run build
```

## Stage 2

**Status: shortcodes + markdown pipeline + image dims complete.**

See `docs/baselines/reports/stage2-gates.md`.

## Stage 3

**Status: visuals + all 10 animations + dual theme complete.**

See `docs/baselines/reports/stage3-gates.md`. JS is 8.88 KB gzip against a 12 KB budget.

## Stage 4

**Status: SEO + RSS + legacy URL map + Nginx 302 release complete.**

See `docs/baselines/reports/stage4-gates.md`.

## Stage 5

**Status: Joe CMS editor + admin-origin patch + AutoRebuild/rebuild-api + host control plane scaffold (incomplete vs plan Final).**

See `docs/baselines/reports/stage5-gates.md` and `stage5-editor-decision.md`.

Honest gaps (adversarial AA-06/07/08):

- `typecho/` tree is plugin/config scaffold only — full CMS vertical login/upload not proven in-repo
- CDN purge stubs record `not-implemented` (never fake `ok`) until OpenAPI is wired
- Baidu push diffs against previous success id captured **before** `last-success-release` overwrite

```powershell
node docker/rebuild-api/test.js
node scripts/stage5-gate.js
```

## Stage 6

**Status: Pagefind + taxonomies + pagination + 404 complete.**

See `docs/baselines/reports/stage6-gates.md`. Search UI loads Pagefind only on first open; verify hits with `astro preview`, not `dev`.

## Stage 7

**Status: Waline scaffold + lazy Comments + fail-closed policy middleware + fixture migration dry-run.**

See `docs/baselines/reports/stage7-gates.md` and `stage7-comment-migration.md`. Production writes stay disabled (`release-state.productionWriteEnabled=false`) until Stage 10 cutover. Mutating `/api/comment` and `/api/comment/*` go through policy; other `/api/*` writes are 403. Live MySQL apply / digest pin / mail remain Stage 9–10.

## Stage 8

**Status: automated audit + agent spot-verify for all 15 public CIDs; blockers = 0. Human Final = 1/15 (friends).**

See `docs/baselines/reports/stage8-gates.md`, `stage8-audit.md`, and `docs/baselines/reviews/cid-*.json`.

Verdict taxonomy:

- `pass` + human reviewer → Final
- `agent-spot` → automated spot-verify only (gate warns; **not** human Final)
- `audit-clean` → `--sync-audit` only

```powershell
node scripts/spot-verify-reviews.js --write
node scripts/stage8-gate.js
```

```powershell
$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run build
npm --prefix astro run preview -- --host 127.0.0.1 --port 4321
```

`PLAYWRIGHT_BROWSERS_PATH` is mandatory: when Chromium cannot launch,
`@beoe/rehype-mermaid` silently drops the entire document instead of failing the build.
`npm run render:gate` catches that, but only after the fact.

Never commit secrets or `backups/`.

## Rules

- Production SSH/MySQL: SELECT / dump / file pull only. No writes, restarts, or config changes.
- Credentials stay in local session env vars, not in this repo.
