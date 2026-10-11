import assert from 'node:assert/strict';
import test from 'node:test';
import { getContent, saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

function asObject(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

test('a revision snapshot keeps the content times, fields, and relationships', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_revobj');
  await root.query('CREATE DATABASE cms_revobj CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_revobj',
  });
  try {
    await ensureCmsSchema(db);
    const saved = await saveContent(db, {
      cid: 1,
      baseRevision: 0,
      title: '完整',
      slug: 'full',
      text: '<!--markdown-->正文\n',
      type: 'post_draft',
      fields: [{ name: 'thumb', type: 'str', str_value: 'a.png' }],
      relationshipMids: [3],
    });
    assert.equal(saved.ok, true, saved.error);
    const content = await getContent(db, 1);
    const [firstRows] = await db.query(
      'SELECT snapshot FROM cms_content_revisions WHERE cid = 1 AND revision = 1',
    );
    const first = asObject(firstRows[0].snapshot);
    assert.equal(first.created, content.created);
    assert.equal(first.modified, content.modified);
    assert.equal(first.fields[0].str_value, 'a.png');
    assert.deepEqual(first.relationships, [3]);
    const frozen = JSON.stringify(first);
    const updated = await saveContent(db, {
      cid: 1,
      baseRevision: 1,
      title: '完整二',
      text: '<!--markdown-->正文\n',
    });
    assert.equal(updated.ok, true, updated.error);
    const [again] = await db.query(
      'SELECT snapshot FROM cms_content_revisions WHERE cid = 1 AND revision = 1',
    );
    assert.equal(JSON.stringify(asObject(again[0].snapshot)), frozen);
    const [secondRows] = await db.query(
      'SELECT snapshot FROM cms_content_revisions WHERE cid = 1 AND revision = 2',
    );
    const second = asObject(secondRows[0].snapshot);
    const latest = await getContent(db, 1);
    assert.equal(second.created, first.created);
    assert.equal(second.modified, latest.modified);
    assert.equal(second.title, '完整二');
    assert.equal(second.fields[0].name, 'thumb');
  } finally {
    await db.end();
  }
});
