export async function assertCmsWritable(db) {
  let rows;
  try {
    [rows] = await db.query('SELECT mode FROM cms_runtime WHERE id = 1');
  } catch (error) {
    if (error && error.code === 'ER_NO_SUCH_TABLE') return;
    throw error;
  }
  if (rows[0]?.mode === 'shadow') {
    const refused = new Error('shadow database refuses writes');
    refused.status = 403;
    throw refused;
  }
}

export async function shadowWriteRefusal(db) {
  try {
    await assertCmsWritable(db);
    return null;
  } catch (error) {
    if (error && error.status === 403) return { ok: false, status: 403, error: error.message };
    throw error;
  }
}
