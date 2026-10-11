import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('a save reports the queue without calling the article published', async (t) => {
  const editor = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/editor/mount.js'), 'utf8');
  assert.match(editor, /这次保存没有进入发布队列/);
  assert.match(editor, /重建请求已入队，状态是/);
  assert.match(editor, /type: 'post_draft'/);
  assert.doesNotMatch(editor, /已上线|发布完成/);
  const page = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/pages/edit/[cid].astro'), 'utf8');
  assert.match(page, /href="https:\/\/build2\.fei\.cx\/"/);
  assert.match(page, /不读取发布清单/);
  assert.doesNotMatch(page, /已上线|发布完成/);
  const api = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/pages/api/contents/[cid].js'), 'utf8');
  assert.match(api, /type: body\.type/);

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
  await root.query('DROP DATABASE IF EXISTS cms_status');
  await root.query('CREATE DATABASE cms_status CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_status',
  });
  try {
    await ensureCmsSchema(db);
    const draft = await saveContent(db, {
      cid: 1,
      baseRevision: 0,
      title: '草稿',
      slug: 'draft',
      text: '<!--markdown-->草稿\n',
      type: 'post_draft',
    });
    assert.equal(draft.ok, true, draft.error);
    assert.equal(draft.publish, null);

    const published = await saveContent(db, {
      cid: 2,
      baseRevision: 0,
      title: '正文',
      slug: 'post',
      text: '<!--markdown-->正文\n',
    });
    assert.deepEqual(published.publish, { state: 'queued', op: 'publish' });
    assert.equal(Object.hasOwn(published, 'published'), false);
    const [row] = await db.query(
      `SELECT status, op FROM cms_publish_outbox WHERE cid = 2`,
    );
    assert.equal(row.length, 1);
    assert.equal(row[0].status, 'pending');
    assert.equal(row[0].op, 'publish');
  } finally {
    await db.end();
  }
});
