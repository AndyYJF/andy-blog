import assert from 'node:assert/strict';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('new moment fields must be JSON arrays and an omitted save keeps the old value', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_moment');
  await root.query('CREATE DATABASE cms_moment CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_moment',
  });
  try {
    await ensureCmsSchema(db);
    const badTopics = await saveContent(db, {
      cid: 1, baseRevision: 0, title: '闲话', slug: 'm', text: '<!--markdown-->闲话\n', type: 'post_draft',
      fields: [{ name: 'moment_topics', type: 'str', str_value: '示例' }],
    });
    assert.equal(badTopics.status, 400);
    const badImages = await saveContent(db, {
      cid: 1, baseRevision: 0, title: '闲话', slug: 'm', text: '<!--markdown-->闲话\n', type: 'post_draft',
      fields: [{ name: 'moment_images', type: 'str', str_value: 'not-json' }],
    });
    assert.equal(badImages.status, 400);
    const saved = await saveContent(db, {
      cid: 1, baseRevision: 0, title: '闲话', slug: 'm', text: '<!--markdown-->闲话\n', type: 'post_draft',
      fields: [
        { name: 'moment_topics', type: 'str', str_value: '["示例"]' },
        { name: 'moment_images', type: 'str', str_value: '[{"src":"/a.png"}]' },
      ],
    });
    assert.equal(saved.ok, true, saved.error);
    await db.query(
      `UPDATE cms_fields SET str_value = '示例' WHERE cid = 1 AND name = 'moment_topics'`,
    );
    const kept = await saveContent(db, {
      cid: 1, baseRevision: 1, title: '闲话二', text: '<!--markdown-->闲话\n',
    });
    assert.equal(kept.ok, true, kept.error);
    const [topics] = await db.query(
      `SELECT str_value FROM cms_fields WHERE cid = 1 AND name = 'moment_topics'`,
    );
    assert.equal(topics[0].str_value, '示例');
  } finally {
    await db.end();
  }
});
