/**
 * Read the i18n translation tables inside an already-open consistent
 * snapshot transaction. Shared by export-typecho-snapshot.js and
 * sync-typecho.js (direct-DB branch). Returns null when the tables do
 * not exist (pre-i18n environments) so callers stay backward compatible.
 */
export async function readI18nTables(db, prefix = 'typecho_') {
  try {
    const [sourceState] = await db.query(
      `SELECT cid, source_revision, source_hash, visibility, content_type, saved_at
       FROM ${prefix}i18n_source_state ORDER BY cid`,
    );
    const [heads] = await db.query(
      `SELECT cid, locale, translation_revision, draft_version_id, approved_version_id,
              publication_state, equivalence_state, updated_at
       FROM ${prefix}i18n_translation_head ORDER BY cid, locale`,
    );
    // Only versions that a head points at; unpublished draft bodies stay out of
    // the snapshot (smaller, and drafts must never reach the build).
    const [versions] = await db.query(
      `SELECT v.version_id, v.cid, v.locale, v.translation_revision, v.title, v.summary,
              v.body, v.source_revision, v.source_hash, v.content_digest,
              v.glossary_version, v.author, v.proofread_at, v.proofreader,
              v.render_verdict, v.render_fingerprint, v.verified_at, v.created_at
       FROM ${prefix}i18n_translation_version v
       JOIN ${prefix}i18n_translation_head h
         ON h.cid = v.cid AND h.locale = v.locale
        AND h.approved_version_id = v.version_id
       ORDER BY v.version_id`,
    );
    const [ledger] = await db.query(
      `SELECT cid, locale, translation_available_at, first_published_at,
              last_live_version_id, last_live_release, updated_at
       FROM ${prefix}i18n_publication_ledger ORDER BY cid, locale`,
    );
    return { sourceState, heads, versions, ledger };
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146)) return null;
    throw e;
  }
}
