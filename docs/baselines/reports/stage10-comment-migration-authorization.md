# Stage 10 Phase 9b — comment stop-write and migration authorization

**Status:** `PHASE9B_COMPLETE`

This is a separate production window after Waline readiness. It does not
authorize comment enable, a release switch, OpenResty changes, CDN purge, or
redirect 301.

## Required owner decision before authorization

The owner selected `/posts/typecho-joe-mermaid/` (CID 47) as the real route
that must reject new comments after enable. Only this content row may change
from `allowComment=1` to `allowComment=0` in Phase 9b.

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

The owner granted this exact Phase 9b scope on 2026-08-09. Comment enable and
all explicit exclusions above remain unauthorized.

## Execution result — 2026-08-09

- Root-only evidence: `/root/stage10-comments/20260809T085719Z-phase9b`.
- Pre-mutation backups passed gzip and SHA-256 verification:
  Typecho `6b88d1b...c0471f`; production Waline `845d2158...7a536`.
- Exactly CID 47 changed, and a 19-column comparison proved the only changed
  field was `allowComment: 1 -> 0`; every other Typecho content row matched.
- All three permanent BEFORE guards passed real blocked INSERT/UPDATE/DELETE
  probes. Typecho stayed running and its two historical comment rows did not
  change.
- Two guarded exports were byte-identical: 2 rows, max coid 11, one approved,
  one waiting, SHA-256 `d770ca7f...2f875a9`.
- Dry-run was clean and rolled back. Apply inserted 2 mappings/comments; its
  second pass was a no-op. A separate second apply run inserted/updated/deleted
  zero rows and reconciliation remained zero-difference. No sweep was needed.
- Final production Waline state: 2 Typecho mappings, 2 distinct mapped comments,
  both canonical URLs present, one approved and one waiting; known-key GET was
  HTTP 200 on loopback and public www.
- Release remained `20260805T143100Z-c92e7d31`, redirect remained 302, comments
  remained globally disabled, `/admin/` remained 404, and no excluded action
  was executed.

Phase 9b is complete. Stop before Phase 9c: comment enable remains a separate
owner-authorized release, and 301 remains prohibited.
