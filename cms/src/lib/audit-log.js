const DROPPED = new Set(['password', 'text', 'secret', 'token', 'body']);

export function auditDetail(detail) {
  if (detail == null || typeof detail !== 'object') return null;
  const clean = {};
  for (const [key, value] of Object.entries(detail)) {
    if (DROPPED.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

export async function appendAudit(db, { actor = 'local', action, cid = null, detail = null, now }) {
  const clean = auditDetail(detail);
  await db.query(
    `INSERT INTO cms_audit_log (created_at, actor, action, cid, detail)
     VALUES (?, ?, ?, ?, ?)`,
    [
      now,
      String(actor || 'local').slice(0, 64),
      String(action).slice(0, 64),
      cid,
      clean == null ? null : JSON.stringify(clean),
    ],
  );
}
