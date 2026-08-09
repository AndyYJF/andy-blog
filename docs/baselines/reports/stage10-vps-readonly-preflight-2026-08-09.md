# Stage 10 VPS read-only preflight — 2026-08-09

**Verdict:** `NOT_READY_FOR_COMMENT_STOP_WRITE`

This report records the owner-authorized read-only preflight against
`root@139.224.71.200`. It does not authorize mutation. Redirect status remains
302 and a 301 transition remains prohibited.

## Scope and non-actions

Executed:

- SSH identity/clock/capacity and listener inventory;
- selected Docker metadata without environment values;
- release marker, deploy state, selected manifest fields, and vhost inspection;
- TLS metadata and GET/header/body-hash probes;
- MySQL `SELECT`, `SHOW`, and `information_schema` aggregates only;
- public browser-like comment GET probes with matching Origin/Referer.

Not executed:

- POST or test-comment creation;
- SQL write, schema apply, backup/restore, or source stop-write;
- remote file creation/edit;
- service reload/restart;
- deploy-state transition, release switch, CDN purge, or 301.

One preflight script stopped before SQL because of a local shell quoting error.
It was replaced with a smaller script covering only the unexecuted checks; the
failed command was not repeated unchanged.

## Confirmed topology

| Surface | Confirmed state |
|---|---|
| Public 80/443 | 1Panel OpenResty |
| Typecho | `1Panel-typecho-f31a`, `127.0.0.1:8080`, database `typecho_frf6hh` |
| MySQL | `1Panel-mysql-RSa9`, MySQL 8.4.5, `127.0.0.1:3306` |
| Production Waline | `andy-blog-waline-waline-1`, `127.0.0.1:8360`, database configured as `waline` |
| Staging Waline | `andy-blog-staging-waline-staging-1`, `127.0.0.1:8361`, database `waline_staging` |
| Docker network | production/staging Waline, Typecho, and MySQL on `1panel-network` |

Production and staging Waline use distinct containers, image IDs, databases,
ports, and read-only deploy mounts. No staging data was treated as production.

## Release and deploy state

- `current` → `releases/20260805T143100Z-c92e7d31`.
- `previous`: missing.
- `candidate`: missing.
- `redirect-status=302`.
- `comment-write-mode=disabled`.
- Manifest agrees on release ID, snapshot epoch `1785565762`, redirect 302, and
  comments disabled.
- `/__release` agrees on origin, public `www`, and `new`.

The missing `previous` marker means `rollback-release.sh` cannot currently
perform the planned static rollback. The retained 1Panel vhost backup can point
back to Typecho, but it is not equivalent to a tested static previous-release
rollback.

## Legacy URL / CDN finding

`/archives/47/` differs between origin and Aliyun:

| View | Status | Evidence |
|---|---:|---|
| origin (`127.0.0.1` with www SNI) | 302 | Location `/posts/typecho-joe-mermaid/` |
| Aliyun public edge | 200 | Tengine, `X-Cache: HIT TCP_MEM_HIT`, canonical-sized body |

The public legacy body SHA-256 equals the origin/public canonical target body
SHA-256 (`c87c6b7a...e57dee0a`). Curl was run with curlrc disabled and redirect
following disabled. This is evidence that Aliyun serves the canonical 200 body
under the legacy cache key, not a client-followed redirect.

Origin/edge agreement is therefore failed and the observation ledger cannot
pass. No cache-bypass, purge, or revalidation mutation was attempted.

## Typecho source aggregates

Actual tables:

- `typecho_frf6hh.typecho_comments`
- `typecho_frf6hh.typecho_contents`

Read-only aggregates:

| Metric | Value |
|---|---:|
| comment rows | 2 |
| `type='comment'` | 2 |
| approved / waiting / spam | 1 / 1 / 0 |
| replies | 0 |
| max coid | 11 |
| orphan parents | 0 |
| public post/page | 15 |
| public `allowComment=1` | 15 |
| public `allowComment=0` | 0 |

Counts align with the Stage 0 fixture, but a full field/source-hash comparison
has not yet been executed. There is still no real closed key for the required
`entry-not-writable` production test.

## Waline schema and read-path findings

- Production database `waline` contains zero tables.
- `waline.wl_Comment` and `waline.astro_comment_migration_map` do not exist.
- Staging contains `wl_Comment`, `wl_Counter`, and `wl_Users`; it has two
  approved comments and no migration map.
- GET without Origin/Referer returns 403 for both environments because Waline
  enforces `SECURE_DOMAINS`; this alone is not a database-read verdict.
- A browser-like GET with matching Origin/Referer returns 200 on `new` but 500
  on production `www`, confirming the production read path is broken while the
  staging path is functional.

The Compose healthcheck requests `/api/comment?path=/` without the public
Origin and declares every response below 500 healthy. It therefore treats the
predictable 403 as PASS and never exercises the production database. Container
`healthy` is false confidence for schema/read readiness.

## Capacity and certificate

- Root disk: 40G total, 30G used, 8.0G available, 79%.
- Memory: 1.6GiB total, approximately 523MiB available at probe time.
- Swap: 2.5GiB total, 2.1GiB used.
- TLS: Let's Encrypt wildcard/site certificate valid through
  `2026-09-27T21:02:04Z`.

Capacity does not prove an immediate failure, but schema apply/build/backup
work should retain rollback data and watch disk/swap headroom.

## Blocking actions before a comment stop-write window

1. Fix the Waline healthcheck to send a valid Origin/Referer, use a real known
   commentKey, and require HTTP 200.
2. Apply the reviewed production Waline schema, including the migration map, to
   database `waline`; verify production remains isolated from staging.
3. Implement and locally test the production MySQL migration/reconciliation
   backend with dry-run, explicit scoped sweep, transaction, and second-run
   zero-change gates.
4. Establish and test a static `previous` release marker or explicitly repair
   the rollback procedure before the mutation window.
5. Resolve the Aliyun legacy cache-key 200 and obtain origin/Aliyun/Cloudflare
   agreement. Real provider purge is still unimplemented in the repository.
6. Select a legitimate closed-comment route or formally keep the closed-key gate
   unmet; an unknown key is not a substitute.
7. Re-run read-only readiness probes. Only after all blockers pass should the
   owner consider a separate authorization for backup and stop-write.

The healthcheck repair in item 1 has been implemented locally and covered by
`stage10:gate` plus `js-yaml` structure validation. It has not been deployed.
The local machine has no Docker CLI, so real `docker compose config` validation
remains unverified and must not be inferred from the YAML parser result.
