import { assertCmsWritable } from './shadow-guard.js';

/** Generic content/metadata rebuild queue. Translation events stay on cms_i18n_publish_outbox. */

export function isPublicContent(row) {
  if (!row) return false;
  return (row.type === 'post' || row.type === 'page')
    && row.status === 'publish'
    && !String(row.password || '');
}

/** Draft, private, and password saves do not ask for a public rebuild. */
export function publishChange(before, after) {
  const wasPublic = isPublicContent(before);
  const nowPublic = isPublicContent(after);
  if (!wasPublic && !nowPublic) return null;
  if (wasPublic && !after) return { op: 'delete' };
  if (wasPublic && !nowPublic) return { op: 'unpublish' };
  if (!wasPublic && nowPublic) return { op: 'publish' };
  return { op: 'update' };
}

export function backoffSeconds(attempts) {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

export function rebuildBody({ now, nonce }) {
  return { event: 'typecho-content-changed', ts: now, nonce };
}

export function applyDelivery({ status, attempts, maxAttempts = 8, error, now }) {
  const nextAttempts = attempts + 1;
  const clearLease = { leaseOwner: null, leaseUntil: null, attempts: nextAttempts };
  if (status === 202) return { ...clearLease, status: 'accepted', lastError: null };
  const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  const message = String(error?.message || `HTTP ${status}`).slice(0, 500);
  if (retryable && nextAttempts < maxAttempts) {
    return {
      ...clearLease,
      status: 'pending',
      nextRetryAt: now + backoffSeconds(nextAttempts),
      lastError: message,
    };
  }
  return { ...clearLease, status: 'failed', lastError: message };
}

export async function enqueuePublish(db, { cid = null, mid = null, revision, op, now }) {
  await db.query('INSERT IGNORE INTO cms_publish_seq (id, next_seq) VALUES (1, 1)');
  const [seqRows] = await db.query('SELECT next_seq FROM cms_publish_seq WHERE id = 1 FOR UPDATE');
  const changeSeq = Number(seqRows[0].next_seq);
  await db.query('UPDATE cms_publish_seq SET next_seq = ? WHERE id = 1', [changeSeq + 1]);
  const idem = cid != null
    ? `content:${cid}:rev:${revision}:${op}`
    : `meta:${mid}:seq:${changeSeq}`;
  await db.query(
    `INSERT INTO cms_publish_outbox
      (idem_key, change_seq, cid, mid, op, status, next_retry_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [idem, changeSeq, cid, mid, op, now, now, now],
  );
  return { changeSeq, idem };
}

export async function recoverExpiredLeases(db, now) {
  const [result] = await db.query(
    `UPDATE cms_publish_outbox
     SET status = 'pending', lease_owner = NULL, lease_until = NULL, updated_at = ?
     WHERE status = 'sending' AND lease_until IS NOT NULL AND lease_until < ?`,
    [now, now],
  );
  return result.affectedRows;
}

export async function claimDue(db, { owner, now, leaseSeconds = 30, limit = 20 }) {
  await assertCmsWritable(db);
  const take = Number(limit);
  if (!Number.isSafeInteger(take) || take < 1 || take > 100) throw new Error('bad claim limit');
  await db.beginTransaction();
  try {
    await recoverExpiredLeases(db, now);
    const [rows] = await db.query(
      `SELECT event_id, idem_key, change_seq, cid, op, attempts, max_attempts
       FROM cms_publish_outbox
       WHERE status = 'pending' AND next_retry_at <= ?
       ORDER BY next_retry_at, event_id
       LIMIT ${take}
       FOR UPDATE`,
      [now],
    );
    if (rows.length) {
      const placeholders = rows.map(() => '?').join(',');
      await db.query(
        `UPDATE cms_publish_outbox
         SET status = 'sending', lease_owner = ?, lease_until = ?, updated_at = ?
         WHERE event_id IN (${placeholders})`,
        [owner, now + leaseSeconds, now, ...rows.map((row) => row.event_id)],
      );
    }
    await db.commit();
    return rows.map((row) => ({ ...row, event_id: Number(row.event_id), attempts: Number(row.attempts) }));
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  }
}

/** Send only after claimDue has committed. Each attempt gets its own nonce; event_id stays. */
export async function deliverClaimed(events, { now, nonceFor, send, db, owner }) {
  if (!owner) throw new Error('delivery requires the lease owner');
  await assertCmsWritable(db);
  const results = [];
  for (const event of events) {
    const nonce = nonceFor(event);
    const payload = rebuildBody({ now, nonce });
    const body = JSON.stringify(payload);
    let status = 0;
    let error = null;
    try {
      status = await send(body, event);
    } catch (err) {
      error = err;
    }
    const decision = applyDelivery({
      status,
      attempts: Number(event.attempts),
      maxAttempts: Number(event.max_attempts || 8),
      error,
      now,
    });
    const recorded = await markDelivery(db, event.event_id, decision, now, owner);
    results.push({
      eventId: Number(event.event_id),
      nonce,
      status: recorded ? decision.status : 'not-recorded',
      recorded,
    });
  }
  return results;
}

export async function markDelivery(db, eventId, decision, now, owner) {
  if (!owner) throw new Error('delivery requires the lease owner');
  const [result] = await db.query(
    `UPDATE cms_publish_outbox
     SET status = ?, attempts = ?, lease_owner = NULL, lease_until = NULL,
         next_retry_at = ?, last_error = ?, updated_at = ?
     WHERE event_id = ? AND status = 'sending' AND lease_owner = ?`,
    [
      decision.status,
      decision.attempts,
      decision.nextRetryAt ?? now,
      decision.lastError,
      now,
      eventId,
      owner,
    ],
  );
  return result.affectedRows === 1;
}

/** Latest generic queue row for a cid. live stays false until a release manifest says otherwise. */
export async function readPublishState(db, cid) {
  const [rows] = await db.query(
    `SELECT event_id, op, status
     FROM cms_publish_outbox
     WHERE cid = ?
     ORDER BY change_seq DESC, event_id DESC
     LIMIT 1`,
    [cid],
  );
  if (!rows.length) return { queue: null, op: null, requestAccepted: false, live: false };
  const row = rows[0];
  return {
    queue: row.status,
    op: row.op,
    eventId: Number(row.event_id),
    requestAccepted: row.status === 'accepted',
    live: false,
  };
}
