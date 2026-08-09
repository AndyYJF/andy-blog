# Stage 10 production Waline readiness — authorization boundary

**Status:** `PAUSED_NEEDS_AUTH_PLUGIN_EXPANSION`

This is the next production step after the local migration backend and gates.
It is deliberately smaller than the Typecho stop-write/migration window.
Nothing in this document authorizes a VPS connection or mutation by itself.

## Proposed target and scope

- SSH target: `root@139.224.71.200` using the already-installed dedicated key.
- Production database only: `waline` on the existing MySQL service.
- Production Waline only: `andy-blog-waline-waline-1` / loopback port 8360.
- Keep `redirect-status=302` and `comment-write-mode=disabled` throughout.
- Keep Typecho running and writable for content; do not change comments yet.
- Do not inspect, copy, modify, merge, or restart staging Waline/database 8361 /
  `waline_staging`.

## Proposed mutations

1. Create a root-only evidence directory under `/root/stage10-comments/<window>/`.
2. Reconfirm 302/disabled, target names, disk headroom, and that production
   `waline` still has zero tables. Stop on drift.
3. Take a compressed production `waline` backup and record size + SHA-256 before
   DDL. Do not back up or modify staging.
4. Apply the reviewed `docker/waline/schema.sql` to database `waline` only.
5. Verify table engines, utf8mb4 collations, required columns,
   `PRIMARY KEY(source, legacy_coid)`, and unique `waline_id`.
6. Install the corrected production healthcheck configuration and recreate only
   the production Waline service if Compose requires recreation. Do not restart
   1Panel OpenResty, MySQL, Typecho, or staging.
7. Require the corrected container healthcheck and a browser-like known-key GET
   through `www` to return HTTP 200. Direct Waline POST must remain 403 because
   the deployed policy is still disabled.
8. Save a sanitized count/status/checksum summary; leave raw evidence root-only.

## Explicit exclusions

- no Typecho comment stop-write or `allowComment` changes;
- no Typecho comment export or comment migration apply;
- no Waline test-comment POST;
- no `comment-write-mode enabled` transition or release switch;
- no OpenResty vhost change/reload;
- no CDN purge, DNS change, CMS move, or redirect 301;
- no database restore or destructive cleanup.

## Stop conditions

Stop without continuing if any of the following occurs:

- target database/container/port does not exactly match production;
- staging identifiers appear in an executable target;
- 302/disabled state or manifest agreement has drifted;
- backup is missing, empty unexpectedly, unreadable, or has no SHA-256;
- schema differs from the reviewed contract or DDL reports an error;
- only a broader service restart would make progress;
- corrected healthcheck or browser-like GET is not HTTP 200;
- direct POST is not 403 while disabled.

After this bounded readiness repair passes, stop again. Typecho stop-write,
fixed export, dry-run/apply/reconciliation, and comment enable require a second
explicit authorization.

## Runtime blocker discovered after schema apply

The reviewed schema was applied and validated, but Waline GET still returns
HTTP 500 with `ER_NOT_SUPPORTED_AUTH_MODE`. Evidence shows:

- production account `waline`@`%` uses `caching_sha2_password`;
- MySQL 8.4.5 has `mysql_native_password` active;
- Waline 1.41.3 uses legacy Node `mysql` 2.18.1, which does not support the
  current account protocol;
- grants are already correctly scoped to `waline`.*;
- candidate Compose is not installed and the container has not been recreated.

Continuing requires a narrow authorization expansion to run one reversible
`ALTER USER`: reapply the existing in-memory `MYSQL_PASSWORD` to the same
`waline`@`%` account with `mysql_native_password`. The script does not print or
write the password, does not alter grants, and automatically restores
`caching_sha2_password` with the same password if the known-key GET does not
become HTTP 200. It does not restart MySQL or any container. Reviewed local
script SHA-256 is recorded in the current planning progress after every local
hardening revision; execute only the reviewed current hash after owner approval.
