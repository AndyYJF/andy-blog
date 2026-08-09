# Stage 10 — production comment stop-write, migration, and reconciliation plan

This plan implements `docs/plan.md` §6.2 and §8.5 step 3. It does not authorize
VPS access, does not enable Waline writes, and does not change redirect status.

## Current state (2026-08-09)

- Production `www` serves release `20260805T143100Z-c92e7d31` with
  `redirectStatus=302` and `commentWriteMode=disabled`.
- Production Waline is isolated at `127.0.0.1:8360`, database `waline`.
  Staging `127.0.0.1:8361` / `waline_staging` is never a migration target.
- Production readiness completed on 2026-08-09: database `waline` has the four
  reviewed empty tables, and both loopback/public known-commentKey GET return
  200 through the strict production healthcheck.
- Typecho remains available only on VPS loopback `127.0.0.1:8080` for writing.
- `scripts/migrate-comments-mysql.js` provides the fail-closed production
  backend and reconciliation report; it has not yet been run against the fixed
  production Typecho export.
- The current manifest has 15 comment keys and all 15 are writable at entry
  level. There is no real closed key for the required production negative test.
- GET probes without Origin/Referer remain invalid because of Waline
  `SECURE_DOMAINS`. The deployed healthcheck now uses a real key with matching
  production Origin/Referer and requires HTTP 200.

## Non-negotiable invariants

1. Typecho is the only comment writer before the cutover; Waline is the only
   comment writer after the cutover. There is no dual-write interval.
2. Stop-write must not bulk-change Typecho `allowComment`. That field feeds the
   per-entry Waline policy; changing it globally would close every key in the
   next release.
3. Source credentials, dumps, exported comments, email addresses, IP addresses,
   and user agents stay outside the repository and `.planning/`.
4. The production migration targets only mapping rows with `source='typecho'`.
   It never sweeps native Waline comments and never touches staging.
5. Any schema mismatch, orphan, cycle, duplicate mapping, missing mapped row,
   field/hash mismatch, late Typecho write, or non-zero second run blocks enable.
6. `comment-write-mode` changes only through
   `host/transition-deploy-state.sh`, followed by a separate release build and
   atomic switch. An ordinary rebuild cannot change it.
7. Redirect status remains 302 throughout this work.

## Required local tooling before the cutover window

Extend the migration tool with a fail-closed production backend. The intended
operator contract is:

```text
set -a
. /root/stage10-comments/<window>/waline-migration.env
set +a
node scripts/migrate-comments-mysql.js \
  --source /root/stage10-comments/<window>/typecho-comments.json \
  --report /root/stage10-comments/<window>/migration-report.json \
  --confirm-database waline \
  --twice [--apply --confirm-source-sha <sha256>] [--apply-sweep]
```

The source file and report path must be absolute and outside the checkout. On
Linux the source must be mode `0600`; the report parent must already exist and
the command refuses to overwrite a report. `--apply-sweep` may be supplied to a
dry-run to preview the scoped deletion transaction; the transaction is still
rolled back unless `--apply` is also present.

The CLI reads credentials only from the five `WALINE_MYSQL_*` variables above,
rejects any database other than the explicitly confirmed `waline`, and never
accepts `waline_staging`. Do not put these values in shell history, the
repository, `.planning/`, or the report. Load them from a root-readable env
file in the authorized VPS script.

The live backend must:

- accept credentials only from environment variables or a root-readable env
  file outside the repository;
- validate the actual Typecho export shape and Waline/map schemas before writes;
- acquire a named migration lock and use one database transaction;
- upsert by `(source, legacy_coid)`, preserving stable Waline IDs;
- map status and normalized fields exactly as the fixture algorithm does;
- backfill `pid` to the direct parent and `rid` to the root comment;
- report the absent-key set before deletion; require explicit `--apply-sweep`;
- refuse a sweep that would orphan a remaining comment;
- compare source count, mapping count, mapping-joined Waline count, duplicates,
  missing/extra rows, normalized field hashes, status, CID/commentKey, timestamps,
  and the full parent graph;
- run twice in the same fixed source snapshot; the second run must report
  `inserted=updated=deleted=0` and no field changes;
- default to rollback/dry-run unless `--apply` is explicit;
- emit a count/hash report that retains exact pending/deleted `legacy_coid` keys
  for deletion review. It must not emit comment bodies, mail, IP, user agents,
  author links, or the source file path.

`docker/waline/schema.sql` is the reviewed schema source, but the migration CLI
does not apply it. The backup-first production schema step is complete. Run
`npm run comments:test`, then the CLI dry-run above, before considering
`--apply` in the separately authorized stop-write window.

## Authorized cutover sequence

No command in this section is run until the owner authorizes VPS access for the
comment window.

### 1. Read-only preflight

1. Confirm `current`, `previous`, release manifest, `redirect-status=302`, and
   `comment-write-mode=disabled`.
2. Confirm production Waline container, port, database name, health, and schema;
   confirm no command references `waline_staging` or port 8361.
3. Discover the real Typecho table prefix and comment/content schemas. Do not
   assume `typecho_` from documentation.
4. Identify the actual Typecho comment submission endpoint and the web-server
   layer that owns `127.0.0.1:8080`.
5. Confirm the Typecho and Waline backup commands and available disk headroom.
6. Select one real public route whose comments should be closed. Preserve its
   `allowComment=false` in the fixed snapshot so the `entry-not-writable` branch
   can be verified honestly. If no route is selected, the closed-key gate stays
   unmet; an unknown key is not an equivalent test.

The 2026-08-09 readiness work repaired the production schema/read path and
strict healthcheck. The remaining owner decision is one real closed route; the
missing static `previous` marker also blocks the later enable release, but does
not authorize or replace the stop-write/migration window.

### 2. Back up, then close Typecho comment writes

1. Create timestamped Typecho and production Waline database backups outside the
   repository; record path, size, SHA-256, and restore command without logging
   credentials.
2. Keep the Typecho comment-submit endpoint absent from public `www` and install
   the reviewed three-trigger guard on `typecho_comments`. It blocks INSERT,
   UPDATE, and DELETE with the fixed guard marker, while leaving
   `typecho_contents`, admin access, and article writing untouched.
3. Require all three guarded SQL probes to fail, preserve every content row's
   `allowComment`, and keep direct production Waline POST at 403 while the
   deployed policy is disabled. The guard remains permanently after cutover.
4. Drain/close the source window by taking two complete guarded exports after
   the quiet interval; their byte-level SHA-256 and row counts must match.

Stopping the Typecho container or bulk-setting `allowComment=0` is not the
default plan because either breaks the authoring path or corrupts the policy
truth source.

### 3. Export one fixed source snapshot

Export all columns needed by the current fixture contract: `coid`, `cid`,
`created`, author fields, mail, URL, IP, user agent, text, type, status, and
`parent`. The export is complete, not `coid > max`. Record row count and SHA-256,
set mode 0600, and keep it outside the checkout.

Use `scripts/export-typecho-comments-mysql.js`; it refuses to export unless the
exact INSERT/UPDATE/DELETE guard triggers are installed, reads in a READ ONLY
transaction, sorts by `coid`, and creates the output exclusively with mode
0600. Credentials come only from `TYPECHO_MYSQL_*` environment variables.

Validate before target writes:

- every selected row has `type='comment'` and a supported status;
- every selected CID maps to one active route/commentKey;
- parent references exist in the selected set;
- the parent graph has no cycle;
- archived pingback/trackback/unsupported rows are counted with reasons.

### 4. Dry-run, apply, and reconcile production Waline

1. Run the MySQL backend without `--apply`; inspect the planned insert/update/
   absent sets and all reconciliation counters.
2. Record the fixed export SHA-256. Run with
   `--apply --confirm-source-sha <sha256> --apply-sweep --twice` only when the
   dry-run is clean. If there are no absent mapped keys, omit `--apply-sweep`.
3. Require all of the following before commit/enable:

| Counter | Required value |
|---|---:|
| selected source - `source='typecho'` mappings | 0 |
| mappings - mapping-joined Waline rows | 0 |
| missing source keys | 0 |
| extra mapped keys after scoped sweep | 0 |
| duplicate source keys or Waline IDs | 0 |
| normalized field/hash mismatches | 0 |
| orphan parent/root references | 0 |
| parent cycles | 0 |
| second-run inserts/updates/deletes | 0 / 0 / 0 |

4. Re-read Typecho after migration. Its count + canonical hash must still equal
   the fixed export. Any late write aborts enable and requires a new full export
   and migration.

### 5. Enable Waline with a separate release

1. Run `host/transition-deploy-state.sh comment-write-mode enabled`.
2. Build a new release that embeds `redirectStatus=302` and
   `commentWriteMode=enabled`; run the normal gates and production candidate
   checks.
3. Atomically switch `current`, reload only 1Panel OpenResty, and verify the
   release ID and manifest/state agreement.
4. Verify historical comments are readable on representative root/reply pages.
5. Submit a clearly labelled test comment to one open key; record the new native
   Waline row separately from Typecho-mapped rows.
6. Submit to the selected closed key and require 403 `entry-not-writable`.
   Submit an unknown key and require 403 `unknown-key` as a separate test.
7. Keep the Typecho comment-submit endpoint permanently read-only.

### 6. Post-enable checks and rollback

- At +15 minutes and +24 hours, read Typecho count/hash again. A late Typecho
  write triggers an immediate transition back to `disabled`, a new fixed export,
  and full reconciliation.
- A release rollback after enable never restores Typecho comment writing.
  Waline remains the comment source of truth; a disabled release only pauses new
  Waline writes.
- Database restore is a separate, explicitly authorized last resort. Do not
  delete native Waline comments created after enable during a normal release
  rollback.

## Evidence bundle

The VPS evidence directory should contain only root-readable raw artifacts:

```text
/root/stage10-comments/<window>/
  typecho-before.sql[.gz]
  waline-before.sql[.gz]
  typecho-comment-guard.txt
  typecho-comment-state.before.txt
  typecho-comment-state.after.txt
  guard-{insert,update,delete}-probe.txt
  typecho-comments-fixed-{1,2}.json
  stop-write-summary.txt
  SHA256SUMS.stop-write
  waline-before.sql[.gz]
  typecho-comments.json
  preflight.txt
  stop-write.txt
  migration-report.json
  reconciliation-report.json
  enable-smoke.txt
  SHA256SUMS
```

Only sanitized count/hash/status summaries may later be copied into the
repository. No credentials or comment PII are committed.

## Authorization boundary

The next VPS step is read-only preflight only. Before connecting, present the
exact SSH target and exact read-only script to the owner and obtain explicit
authorization. Stop again before backups, stop-write, migration, state
transition, release switch, or test-comment creation if those mutations were not
included in the authorization.
