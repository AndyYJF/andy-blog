# Stage 10 Phase 9b — comment stop-write and migration authorization

**Status:** `AWAITING_CLOSED_KEY_AND_OWNER_AUTHORIZATION`

This is a separate production window after Waline readiness. It does not
authorize comment enable, a release switch, OpenResty changes, CDN purge, or
redirect 301.

## Required owner decision before authorization

Select one real public route that must reject new comments after enable. The
recommended existing-key candidate is `/posts/typecho-joe-mermaid/` (CID 47),
because it already has historical-comment/read-path coverage. Do not change
its `allowComment` until the owner names the route explicitly.

## Proposed authorized mutations

1. Reconfirm production remains release `20260805T143100Z-c92e7d31`, redirect
   302, comments disabled, Waline healthy, and staging isolated.
2. Create a new root-only evidence directory; back up the complete Typecho and
   production Waline databases and verify gzip/SHA-256 before stop-write.
3. If the owner selected a closed route, change only that exact Typecho content
   row's `allowComment` to 0; do not bulk-change content policy.
4. Install the reviewed permanent INSERT/UPDATE/DELETE BEFORE-trigger guard on
   `typecho_frf6hh.typecho_comments`; verify its three write probes are blocked
   while Typecho article writing/container remain available.
5. Produce two complete guarded 0600 Typecho comment exports after the quiet
   interval; require identical bytes, SHA-256, counts, and canonical hash.
6. Run the production Waline migration dry-run. Only if it is clean, apply the
   same fixed source with confirmed SHA-256, explicit scoped sweep if needed,
   `--twice`, and zero-difference reconciliation.
7. Re-read Typecho and require it still matches the fixed export. Save only
   sanitized count/hash reports in the repository; keep raw PII root-only.
8. Stop. Do not enable comments or build/switch a release in this window.

## Explicit exclusions

- no removal of the Typecho comment guard after success;
- no Typecho container stop/restart and no article-content modification other
  than the single owner-selected `allowComment` row;
- no staging database/container read, write, merge, restart, or migration;
- no production Waline test-comment POST;
- no `comment-write-mode enabled`, release build/switch, or OpenResty reload;
- no CDN purge, DNS change, database restore, destructive cleanup, or 301.

Any backup, trigger, fixed-export, dry-run, source-stability, migration, or
reconciliation failure stops the window before enable. A database restore is a
separate authorization.
