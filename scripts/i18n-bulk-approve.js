#!/usr/bin/env node
/**
 * Bulk-approve every translation whose draft pointer differs from the
 * approved pointer. Replicates the I18n plugin approve() transaction
 * (typecho/usr/plugins/I18n/Action.php) so outbox + ledger stay consistent.
 *
 * Usage:
 *   DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=i18n_worker DB_PASSWORD=... \
 *   DB_NAME=typecho_frf6hh DB_PREFIX=typecho_ node scripts/i18n-bulk-approve.js [--dry-run]
 */
import mysql from 'mysql2/promise';

const dryRun = process.argv.includes('--dry-run');
const prefix = process.env.DB_PREFIX || 'typecho_';

const db = await mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 2,
});

const [rows] = await db.query(
  `SELECT h.cid, h.locale, h.draft_version_id, h.approved_version_id, v.content_digest
   FROM ${prefix}i18n_translation_head h
   JOIN ${prefix}i18n_translation_version v
     ON v.version_id = h.draft_version_id AND v.cid = h.cid AND v.locale = h.locale
   WHERE h.publication_state = 'enabled'
     AND h.draft_version_id IS NOT NULL
     AND (h.approved_version_id IS NULL OR h.approved_version_id <> h.draft_version_id)`,
);
console.log(`bulk-approve: ${rows.length} pending approval(s)${dryRun ? ' [dry-run]' : ''}`);

let ok = 0;
for (const row of rows) {
  const { cid, locale, draft_version_id: versionId, content_digest: digest } = row;
  if (dryRun) {
    console.log(`  would approve ${cid}:${locale} version ${versionId}`);
    continue;
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Re-verify the head FOR UPDATE (Action.php parity) — skips if raced.
    const [heads] = await conn.query(
      `SELECT draft_version_id, approved_version_id, publication_state
       FROM ${prefix}i18n_translation_head WHERE cid = ? AND locale = ? FOR UPDATE`,
      [cid, locale],
    );
    const head = heads[0];
    if (!head || head.publication_state !== 'enabled'
        || Number(head.draft_version_id) !== Number(versionId)
        || Number(head.approved_version_id) === Number(versionId)) {
      await conn.rollback();
      console.log(`  skip ${cid}:${locale} (head moved)`);
      continue;
    }
    await conn.query(
      `UPDATE ${prefix}i18n_translation_head
       SET approved_version_id = ?, updated_at = UNIX_TIMESTAMP()
       WHERE cid = ? AND locale = ?`,
      [versionId, cid, locale],
    );
    await conn.query(
      `UPDATE ${prefix}i18n_translation_version
       SET proofread_at = UNIX_TIMESTAMP(), proofreader = 'manual:bulk'
       WHERE version_id = ? AND content_digest = ?`,
      [versionId, digest],
    );
    await conn.query(
      `INSERT IGNORE INTO ${prefix}i18n_publish_outbox
         (idem_key, cid, locale, version_id, status, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
      [`publish:${cid}:${locale}:${versionId}`, cid, locale, versionId],
    );
    await conn.query(
      `INSERT INTO ${prefix}i18n_publication_ledger (cid, locale, translation_available_at, updated_at)
       VALUES (?, ?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         translation_available_at = IFNULL(translation_available_at, VALUES(translation_available_at)),
         updated_at = VALUES(updated_at)`,
      [cid, locale],
    );
    await conn.commit();
    ok += 1;
    console.log(`  approved ${cid}:${locale} version ${versionId}`);
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    console.error(`  FAIL ${cid}:${locale}: ${err.message}`);
  } finally {
    conn.release();
  }
}
console.log(`bulk-approve done: ${ok}/${rows.length}`);
await db.end();
