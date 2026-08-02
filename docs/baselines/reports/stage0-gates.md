# Stage 0 exclusion / gate report

Snapshot epoch: `1785565762` (captured from MySQL `UNIX_TIMESTAMP()` during read-only backup).

## Public export set

- posts publish: **12**
- pages publish: **3**
- future_count: **0**
- password_count: **0**
- excluded rows (non-public / future / password): **none** (EXCLUDED section empty)
- accidental export of future/password/hidden: **0**

Public CIDs: `2,5,11,13,16,30,33,34,41,47,61,62,66,68,76`

## Engine / theme

- All business tables InnoDB
- MySQL 8.4.5
- Active theme: **Joe** (disk: `/opt/1panel/apps/typecho/typecho/data/usr/themes/Joe`)
- siteUrl: `https://www.andy-y.cn`
- rewrite: `0` (permalinks via `/index.php/...`)
- postsListSize: `10` (matches RSS window)

## Format / fields

- All public posts/pages are markdown mode (`<!--markdown-->`)
- Custom fields present: `abstract`, `description`, `keywords`, `mode`, `thumb`, `video` (cover field candidate: **thumb**)
- Local `/usr/uploads/` refs in text: **3**; uploads tree ~112K / 2 files (copied under `backups/typecho-uploads/`)

## Multi-category note

Multi-category CIDs include `20`, which is **not** in the public set (relations query is not status-filtered). Public multi-category CIDs must be preserved in full during sync.

## Comments baseline

- approved: 1
- waiting: 1
- orphan comments: none

## RSS fixture

- Saved: `docs/baselines/rss/live-feed-20260801.xml`
- Item count: **10**
- Sample GUID pattern: `https://www.andy-y.cn/index.php/archives/{cid}/`

## Backup artifacts (gitignored)

See `docs/baselines/backup-manifest.json` for dump SHA-256 and paths.

## Shortcode observation (for stage 2)

Live bodies use Joe `{message type="..." content="..."}` style and Mermaid fences; plan examples used `{alert}` — conversion must match **actual** Joe shortcodes, not only the plan sketch.
