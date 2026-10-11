import assert from 'node:assert/strict';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { contentWriteFromBody } from '../cms/src/lib/content-write.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('a content write keeps omitted fields and stores the ones the body names', async (t) => {
  const omitted = contentWriteFromBody({
    text: '<!--markdown-->正文\n',
    baseRevision: 1,
    title: '标题',
  });
  assert.equal(omitted.ok, true);
  assert.equal(Object.hasOwn(omitted.input, 'fields'), false);
  assert.equal(Object.hasOwn(omitted.input, 'relationshipMids'), false);
  assert.equal(Object.hasOwn(omitted.input, 'password'), false);
  const bad = contentWriteFromBody({
    text: '<!--markdown-->正文\n',
    baseRevision: 0,
    relationshipMids: [0],
  });
  assert.equal(bad.status, 400);

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
  await root.query('DROP DATABASE IF EXISTS cms_writeapi');
  await root.query('CREATE DATABASE cms_writeapi CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_writeapi',
  });
  try {
    await ensureCmsSchema(db);
    const created = contentWriteFromBody({
      text: '<!--markdown-->正文\n',
      baseRevision: 0,
      title: '标题',
      slug: 'write-api',
      type: 'post',
      status: 'publish',
      fields: [{ name: 'legacy_note', type: 'str', str_value: '接口' }],
      relationshipMids: [2],
    });
    const saved = await saveContent(db, { cid: 4, ...created.input });
    assert.equal(saved.ok, true, saved.error);
    const keptBody = contentWriteFromBody({
      text: '<!--markdown-->正文\n',
      baseRevision: 1,
      title: '标题二',
    });
    const kept = await saveContent(db, { cid: 4, ...keptBody.input });
    assert.equal(kept.ok, true, kept.error);
    const [note] = await db.query(
      `SELECT str_value FROM cms_fields WHERE cid = 4 AND name = 'legacy_note'`,
    );
    const [links] = await db.query('SELECT mid FROM cms_relationships WHERE cid = 4');
    assert.equal(note[0].str_value, '接口');
    assert.deepEqual(links.map((row) => Number(row.mid)), [2]);
    const clearedBody = contentWriteFromBody({
      text: '<!--markdown-->正文\n',
      baseRevision: 2,
      title: '标题二',
      fields: [],
      relationshipMids: [],
      password: 'secret',
    });
    const cleared = await saveContent(db, { cid: 4, ...clearedBody.input });
    assert.equal(cleared.ok, true, cleared.error);
    const [fields] = await db.query('SELECT COUNT(*) AS n FROM cms_fields WHERE cid = 4');
    const [left] = await db.query('SELECT COUNT(*) AS n FROM cms_relationships WHERE cid = 4');
    const [row] = await db.query('SELECT password FROM cms_contents WHERE cid = 4');
    assert.equal(Number(fields[0].n), 0);
    assert.equal(Number(left[0].n), 0);
    assert.equal(row[0].password, 'secret');
  } finally {
    await db.end();
  }
});

test('comment and feed flags stay when omitted and change when named', async (t) => {
  const bad = contentWriteFromBody({
    text: '<!--markdown-->正文\n',
    baseRevision: 0,
    allowFeed: 'yes',
  });
  assert.equal(bad.status, 400);
  const omitted = contentWriteFromBody({
    text: '<!--markdown-->正文\n',
    baseRevision: 0,
  });
  assert.equal(Object.hasOwn(omitted.input, 'allowFeed'), false);

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
  await root.query('DROP DATABASE IF EXISTS cms_flags');
  await root.query('CREATE DATABASE cms_flags CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_flags',
  });
  try {
    await ensureCmsSchema(db);
    const created = contentWriteFromBody({
      text: '<!--markdown-->闲话\n',
      baseRevision: 0,
      title: '闲话',
      slug: 'flag-moment',
      type: 'post',
      status: 'publish',
      allowComment: 0,
      allowPing: false,
      allowFeed: '0',
      fields: [{ name: 'content_kind', type: 'str', str_value: 'moment' }],
    });
    const saved = await saveContent(db, { cid: 7, ...created.input });
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.publish?.op, 'publish');
    const [row] = await db.query(
      'SELECT allowComment, allowPing, allowFeed FROM cms_contents WHERE cid = 7',
    );
    assert.deepEqual(
      [row[0].allowComment, row[0].allowPing, row[0].allowFeed],
      ['0', '0', '0'],
    );
    const kept = await saveContent(db, {
      cid: 7,
      baseRevision: 1,
      title: '闲话',
      text: '<!--markdown-->闲话\n',
    });
    assert.equal(kept.ok, true, kept.error);
    const [still] = await db.query(
      'SELECT allowFeed FROM cms_contents WHERE cid = 7',
    );
    assert.equal(still[0].allowFeed, '0');
    const opened = await saveContent(db, {
      cid: 7,
      baseRevision: 2,
      title: '闲话',
      text: '<!--markdown-->闲话\n',
      allowFeed: '1',
    });
    assert.equal(opened.ok, true, opened.error);
    assert.equal(opened.publish?.op, 'update');
    const [revision] = await db.query(
      'SELECT allowFeed FROM cms_content_revisions WHERE cid = 7 AND revision = 3',
    );
    assert.equal(revision[0].allowFeed, '1');
  } finally {
    await db.end();
  }
});
