# Stage 1 gates

Date: 2026-08-01  
Snapshot: `1785565762` (fixture from stage0 dump)

## Done

- Persistent `data/route-map.json` + `data/meta-route-map.json`
- Page canonicals (manual): `/about/` · `/friends/` · `/dn42/`
- `scripts/sync-typecho.js` (fixture or MySQL) with fixed `SNAPSHOT_EPOCH`
- Content Collections (`astro/src/content.config.ts`) — schema **without** `slug`
- Routes: `/`, `/posts/[id]/`, catch-all pages
- Minimal `BaseLayout` (no motion polish)

## Gate results

| Check | Result |
|---|---|
| SQL public CID = output CID = active route CID | PASS (15) |
| Two syncs: digest + content tree + manifest byte-equal | PASS |
| `entry` files named by `routeId` / frontmatter `slug` | PASS (`node scripts/check-entry-ids.js`) |
| `astro build` | PASS (16 HTML pages) |

## Commands

```powershell
$env:SNAPSHOT_EPOCH = "1785565762"
npm run sync
node scripts/stage1-gate.js
node scripts/check-entry-ids.js
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm --prefix astro run build
```

## Notes for later stages

- Joe shortcodes (`{message}` / `{alert}`) still raw in markdown — stage 2
- Unknown fence langs (`commend`, `context`, …) warn via Expressive Code — stage 2/8
- Cover field aligned to `thumb` (`FIELD_COVER`)
