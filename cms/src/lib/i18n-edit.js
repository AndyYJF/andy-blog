import { appendAudit } from './audit-log.js';
import { authorizeSession } from './auth-session.js';
import { shadowWriteRefusal } from './shadow-guard.js';

function badParams() {
  return { ok: false, status: 400, error: 'bad-params' };
}

export async function listTranslations(db, { cid, locale }) {
  if (!Number.isInteger(cid) || cid <= 0 || typeof locale !== 'string' || !/^[a-z]{2,8}$/.test(locale)) {
    return badParams();
  }
  const [heads] = await db.query(
    `SELECT approved_version_id, draft_version_id, publication_state
     FROM cms_i18n_translation_head WHERE cid = ? AND locale = ?`,
    [cid, locale],
  );
  if (!heads.length) return { ok: false, status: 404, error: 'head-missing' };
  const [versions] = await db.query(
    `SELECT version_id, title, body, content_digest, proofreader
     FROM cms_i18n_translation_version
     WHERE cid = ? AND locale = ? ORDER BY version_id`,
    [cid, locale],
  );
  const head = heads[0];
  return {
    ok: true,
    approvedVersionId: head.approved_version_id == null ? null : Number(head.approved_version_id),
    draftVersionId: head.draft_version_id == null ? null : Number(head.draft_version_id),
    publicationState: head.publication_state,
    versions: versions.map((row) => ({
      versionId: Number(row.version_id),
      title: row.title,
      body: row.body,
      contentDigest: row.content_digest,
      proofreader: row.proofreader,
    })),
  };
}

export async function readTranslations(db, { cid, locale, cookie, csrf, now }) {
  const session = await authorizeSession(db, { cookie, csrf, now });
  if (!session.ok) return session;
  return listTranslations(db, { cid, locale });
}

export async function approveTranslation(db, { cid, locale, versionId, digest, proofreader }) {
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(versionId) || versionId <= 0) return badParams();
  if (typeof locale !== 'string' || !/^[a-z]{2,8}$/.test(locale)) return badParams();
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return badParams();
  if (typeof proofreader !== 'string' || !/^human:[0-9]+$/.test(proofreader) || proofreader.length > 40) return badParams();
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [heads] = await db.query(
      `SELECT approved_version_id FROM cms_i18n_translation_head
       WHERE cid = ? AND locale = ? FOR UPDATE`,
      [cid, locale],
    );
    if (!heads.length) {
      await db.rollback();
      return { ok: false, status: 404, error: 'head-missing' };
    }
    const [versions] = await db.query(
      `SELECT version_id, content_digest FROM cms_i18n_translation_version
       WHERE version_id = ? AND cid = ? AND locale = ?`,
      [versionId, cid, locale],
    );
    if (!versions.length) {
      await db.rollback();
      return { ok: false, status: 404, error: 'version-missing' };
    }
    if (versions[0].content_digest !== digest) {
      await db.rollback();
      return { ok: false, status: 409, error: 'digest-mismatch' };
    }
    await db.query(
      `UPDATE cms_i18n_translation_head
       SET approved_version_id = ?, updated_at = ?
       WHERE cid = ? AND locale = ?`,
      [versionId, now, cid, locale],
    );
    const [stamped] = await db.query(
      `UPDATE cms_i18n_translation_version
       SET proofread_at = ?, proofreader = ?
       WHERE version_id = ? AND content_digest = ?`,
      [now, proofreader, versionId, digest],
    );
    if (stamped.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 409, error: 'digest-mismatch' };
    }
    await db.query(
      `INSERT IGNORE INTO cms_i18n_publish_outbox
        (idem_key, cid, locale, version_id, status, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [`publish:${cid}:${locale}:${versionId}`, cid, locale, versionId, now, now, now],
    );
    await db.query(
      `INSERT INTO cms_i18n_publication_ledger
        (cid, locale, translation_available_at, updated_at)
       VALUES (?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE
         translation_available_at = IFNULL(cms_i18n_publication_ledger.translation_available_at, new.translation_available_at),
         updated_at = new.updated_at`,
      [cid, locale, now, now],
    );
    await appendAudit(db, {
      action: 'translation.approve',
      cid,
      detail: { locale, versionId, proofreader },
      now,
    });
    await db.commit();
    return { ok: true, approvedVersionId: versionId };
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  }
}

export async function setTranslationPublication(db, { cid, locale, state }) {
  if (state !== 'enabled' && state !== 'disabled') throw new Error('bad publication state');
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [updated] = await db.query(
      `UPDATE cms_i18n_translation_head
       SET publication_state = ?, updated_at = ?
       WHERE cid = ? AND locale = ?`,
      [state, now, cid, locale],
    );
    if (updated.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 404, error: 'head missing' };
    }
    if (state === 'disabled') {
      await db.query(
        `UPDATE cms_i18n_translation_job
         SET status = 'cancelled', updated_at = ?
         WHERE cid = ? AND locale = ? AND status IN ('queued', 'leased', 'failed')`,
        [now, cid, locale],
      );
      await db.query(
        `UPDATE cms_i18n_publish_outbox
         SET status = 'cancelled', updated_at = ?
         WHERE cid = ? AND locale = ? AND status IN ('pending', 'accepted', 'needs_fix')`,
        [now, cid, locale],
      );
    }
    await appendAudit(db, { action: 'translation.publication', cid, detail: { locale, state }, now });
    await db.commit();
    return { ok: true, publicationState: state };
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  }
}
