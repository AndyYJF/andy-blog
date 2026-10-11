import { appendAudit } from './audit-log.js';
import { enqueuePublish } from './publish-outbox.js';
import { shadowWriteRefusal } from './shadow-guard.js';

const META_TYPES = new Set(['category', 'tag']);

function bad(error) {
  return { ok: false, status: 400, error };
}

function cleanText(value, max) {
  if (value == null) return null;
  const text = String(value);
  if (text.length > max) return undefined;
  return text;
}

async function metaIsPublic(db, mid) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n
     FROM cms_relationships r
     JOIN cms_contents c ON c.cid = r.cid
     WHERE r.mid = ?
       AND c.type IN ('post', 'page')
       AND c.status = 'publish'
       AND (c.password IS NULL OR c.password = '')`,
    [mid],
  );
  return Number(rows[0].n) > 0;
}

async function writeMetaLog(db, { op, mid, before, after, now }) {
  await db.query(
    `INSERT INTO cms_change_log (table_name, op, mid, before_json, after_json, created_at)
     VALUES ('cms_metas', ?, ?, ?, ?, ?)`,
    [op, mid, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, now],
  );
}

function sameMeta(current, next) {
  return current.name === next.name
    && current.slug === next.slug
    && current.type === next.type
    && current.description === next.description
    && Number(current.order) === Number(next.order)
    && Number(current.parent) === Number(next.parent);
}

export async function saveMeta(db, input) {
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const creating = input.mid == null;
  const name = cleanText(input.name, 200);
  const slug = cleanText(input.slug, 200);
  const type = input.type == null ? null : String(input.type);
  const description = input.description === undefined ? undefined : cleanText(input.description, 200);
  if (name == null || name === '' || slug == null || slug === '' || !META_TYPES.has(type)) return bad('bad meta');
  if (description === undefined && input.description !== undefined) return bad('bad meta');
  if (creating && input.baseSlug !== undefined) return bad('bad meta');
  const orderGiven = input.order == null ? null : Number(input.order);
  const parentGiven = input.parent == null ? null : Number(input.parent);
  if (orderGiven != null && (!Number.isInteger(orderGiven) || orderGiven < 0)) return bad('bad meta');
  if (parentGiven != null && (!Number.isInteger(parentGiven) || parentGiven < 0)) return bad('bad meta');
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    if (creating) {
      const order = orderGiven == null ? 0 : orderGiven;
      const parent = parentGiven == null ? 0 : parentGiven;
      const [inserted] = await db.query(
        `INSERT INTO cms_metas (name, slug, type, description, count, \`order\`, parent)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [name, slug, type, description === undefined ? null : description, order, parent],
      );
      const mid = Number(inserted.insertId);
      const after = { name, slug, type, description: description === undefined ? null : description, order, parent };
      await writeMetaLog(db, { op: 'insert', mid, before: null, after, now });
      await appendAudit(db, { action: 'meta.save', detail: { mid, op: 'insert' }, now });
      await db.commit();
      return { ok: true, mid, enqueued: false };
    }
    const mid = Number(input.mid);
    if (!Number.isInteger(mid) || mid <= 0) {
      await db.rollback();
      return bad('bad meta');
    }
    const [rows] = await db.query(
      'SELECT mid, name, slug, type, description, `order`, parent FROM cms_metas WHERE mid = ? FOR UPDATE',
      [mid],
    );
    if (!rows.length) {
      await db.rollback();
      return { ok: false, status: 404, error: 'missing meta' };
    }
    const current = rows[0];
    if (String(current.slug ?? '') !== String(input.baseSlug ?? '')) {
      await db.rollback();
      return { ok: false, status: 409, error: 'meta conflict' };
    }
    const next = {
      name,
      slug,
      type,
      description: description === undefined ? current.description : description,
      order: orderGiven == null ? Number(current.order) : orderGiven,
      parent: parentGiven == null ? Number(current.parent) : parentGiven,
    };
    if (sameMeta(current, next)) {
      await db.commit();
      return { ok: true, mid, enqueued: false };
    }
    const [updated] = await db.query(
      `UPDATE cms_metas
       SET name = ?, slug = ?, type = ?, description = ?, \`order\` = ?, parent = ?
       WHERE mid = ? AND slug = ?`,
      [next.name, next.slug, next.type, next.description, next.order, next.parent, mid, current.slug],
    );
    if (updated.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 409, error: 'meta conflict' };
    }
    await writeMetaLog(db, { op: 'update', mid, before: current, after: next, now });
    const enqueued = await metaIsPublic(db, mid);
    if (enqueued) await enqueuePublish(db, { mid, op: 'meta', now });
    await appendAudit(db, { action: 'meta.save', detail: { mid, op: 'update' }, now });
    await db.commit();
    return { ok: true, mid, enqueued };
  } catch (error) {
    try { await db.rollback(); } catch { /* already closed */ }
    throw error;
  }
}

export async function deleteMeta(db, { mid, baseSlug }) {
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const id = Number(mid);
  if (!Number.isInteger(id) || id <= 0) return bad('bad meta');
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      'SELECT mid, name, slug, type, description, `order`, parent FROM cms_metas WHERE mid = ? FOR UPDATE',
      [id],
    );
    if (!rows.length) {
      await db.rollback();
      return { ok: false, status: 404, error: 'missing meta' };
    }
    const current = rows[0];
    if (String(current.slug ?? '') !== String(baseSlug ?? '')) {
      await db.rollback();
      return { ok: false, status: 409, error: 'meta conflict' };
    }
    const enqueued = await metaIsPublic(db, id);
    await db.query('DELETE FROM cms_relationships WHERE mid = ?', [id]);
    const [removed] = await db.query('DELETE FROM cms_metas WHERE mid = ? AND slug = ?', [id, current.slug]);
    if (removed.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 409, error: 'meta conflict' };
    }
    await writeMetaLog(db, { op: 'delete', mid: id, before: current, after: null, now });
    if (enqueued) await enqueuePublish(db, { mid: id, op: 'meta', now });
    await appendAudit(db, { action: 'meta.delete', detail: { mid: id, op: 'delete' }, now });
    await db.commit();
    return { ok: true, mid: id, enqueued };
  } catch (error) {
    try { await db.rollback(); } catch { /* already closed */ }
    throw error;
  }
}
