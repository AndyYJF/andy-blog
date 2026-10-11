import assert from 'node:assert/strict';
import test from 'node:test';
import { getContent, saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('a value past the column length is rejected instead of truncated', async (t) => {
  const mysql = await import('mysql2/promise');
  let root;
  try {
    root = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_width');
  await root.query('CREATE DATABASE cms_width CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_width',
  });
  try {
    await ensureCmsSchema(db);
    await db.query("SET SESSION sql_mode = ''");
    const title = '题'.repeat(200);
    const saved = await saveContent(db, {
      cid: 1, baseRevision: 0, title, slug: 'width', text: '<!--markdown-->正文\n', type: 'post_draft',
    });
    assert.equal(saved.ok, true, saved.error);
    assert.equal((await getContent(db, 1)).title, title);
    const tooLong = await saveContent(db, {
      cid: 1, baseRevision: 1, title: '题'.repeat(201), slug: 'width', text: '<!--markdown-->正文\n',
    });
    assert.equal(tooLong.status, 400);
    assert.equal((await getContent(db, 1)).title, title);
    const password = await saveContent(db, {
      cid: 2, baseRevision: 0, title: '口令', slug: 'pw', text: '<!--markdown-->口令\n', password: 'p'.repeat(33),
    });
    assert.equal(password.status, 400);
    assert.equal(await getContent(db, 2), null);
  } finally {
    await db.end();
  }
});
