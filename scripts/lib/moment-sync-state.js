/**
 * Shared moment snapshot / tombstone helpers used by sync and tests.
 */

/** Typecho content types pulled into snapshots for disposition classification. */
export const SNAPSHOT_CONTENT_TYPES = ['post', 'page', 'post_draft'];

export const SNAPSHOT_CONTENT_TYPES_SQL = SNAPSHOT_CONTENT_TYPES.map((t) => `'${t}'`).join(',');

/**
 * When an active moment route is no longer public, classify the tombstone.
 * Draft/withdrawn rows still present as post_draft → withdrawn (may republish).
 * Missing row or non-moment → gone (refuse revive).
 */
export function momentDispositionForMissingPublic({ row, contentKind }) {
  if (!row) return 'gone';
  const stillMoment =
    (row.type === 'post' || row.type === 'post_draft')
    && contentKind === 'moment';
  return stillMoment ? 'withdrawn' : 'gone';
}
