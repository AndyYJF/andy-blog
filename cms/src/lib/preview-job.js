import { appendAudit } from './audit-log.js';
import { shadowWriteRefusal } from './shadow-guard.js';

const BLOCKED = ['endpoint', 'rebuild', 'url', 'webhook'];

export async function simulatePreviewJob(db, { cid, baseRevision, body }) {
  if (body && BLOCKED.some((key) => Object.hasOwn(body, key))) {
    return { ok: false, status: 400, error: 'preview simulation does not call a rebuild endpoint' };
  }
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(baseRevision) || baseRevision < 1) {
    return { ok: false, status: 400, error: 'bad-params' };
  }
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      'SELECT revision FROM cms_contents WHERE cid = ? FOR UPDATE',
      [cid],
    );
    if (!rows.length) {
      await db.rollback();
      return { ok: false, status: 404, error: 'missing content' };
    }
    const revision = Number(rows[0].revision);
    if (revision !== baseRevision) {
      await db.rollback();
      return { ok: false, status: 409, error: 'revision conflict' };
    }
    await appendAudit(db, {
      action: 'preview.simulate',
      cid,
      detail: { revision, simulated: true, dist: null, live: false },
      now,
    });
    await db.commit();
    return { ok: true, simulated: true, revision, dist: null, live: false };
  } catch (error) {
    try { await db.rollback(); } catch { /* already closed */ }
    throw error;
  }
}
