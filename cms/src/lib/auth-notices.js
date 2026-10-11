const NOTICE_ACTIONS = ['auth.recover', 'auth.offline-rebind'];

export async function listAuthNotices(db) {
  const [rows] = await db.query(
    `SELECT action, created_at FROM cms_audit_log
     WHERE action IN (?, ?)
     ORDER BY audit_id DESC LIMIT 5`,
    NOTICE_ACTIONS,
  );
  return rows.map((row) => ({
    action: row.action,
    createdAt: Number(row.created_at),
  }));
}
