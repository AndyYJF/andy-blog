import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { saveContent, sha256Text } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('imported html stays byte for byte and a new article must be markdown', async (t) => {
  const importer = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/lib/import-apply.js'), 'utf8');
  assert.doesNotMatch(importer, /text-fidelity|prepareEditorDocument|textForSave/);
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
  await root.query('DROP DATABASE IF EXISTS cms_html');
  await root.query('CREATE DATABASE cms_html CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_html',
  });
  try {
    await ensureCmsSchema(db);
    const html = '<p>存量 HTML</p>';
    await db.query(
      `INSERT INTO cms_contents
        (cid, title, slug, created, modified, text, \`order\`, authorId, type, status,
         allowComment, allowPing, allowFeed, parent, revision, text_sha256)
       VALUES (8, 'HTML 存量', 'html', 1, 1, ?, 0, 1, 'post', 'publish', '1', '0', '1', 0, 1, ?)`,
      [html, sha256Text(html)],
    );
    const rewritten = await saveContent(db, {
      cid: 8, baseRevision: 1, title: 'HTML 存量', slug: 'html', text: '<!--markdown-->改写\n',
    });
    assert.equal(rewritten.ok, false);
    assert.equal(rewritten.status, 400);
    const titled = await saveContent(db, {
      cid: 8, baseRevision: 1, title: 'HTML 标题', slug: 'html', text: html,
    });
    assert.equal(titled.ok, true, titled.error);
    const [kept] = await db.query('SELECT title, text, revision FROM cms_contents WHERE cid = 8');
    assert.equal(kept[0].title, 'HTML 标题');
    assert.equal(kept[0].text, html);
    assert.equal(Number(kept[0].revision), 2);

    const bare = await saveContent(db, {
      cid: 11, baseRevision: 0, title: '新 HTML', slug: 'new-html', text: '<p>new</p>',
    });
    assert.equal(bare.status, 400);
    const markdown = await saveContent(db, {
      cid: 12, baseRevision: 0, title: '新文', slug: 'new-md', text: '<!--markdown-->新文\n', type: 'post_draft',
    });
    assert.equal(markdown.ok, true, markdown.error);
    const attachment = await saveContent(db, {
      cid: 9, baseRevision: 0, title: '文件', slug: 'file', type: 'attachment',
      text: '{"path":"usr/uploads/sample.txt"}',
    });
    assert.equal(attachment.ok, true, attachment.error);
    const [rows] = await db.query('SELECT cid FROM cms_contents ORDER BY cid');
    assert.deepEqual(rows.map((row) => Number(row.cid)), [8, 9, 12]);
  } finally {
    await db.end();
  }
});
