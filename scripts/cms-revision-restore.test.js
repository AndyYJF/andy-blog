import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCmsSchema, getContent, restoreContentRevision, saveContent } from '../cms/src/lib/content-store.js';
import { sourceHash } from './lib/i18n-store.js';

test('restoring a revision rewrites the row under the current lock', async (t) => {
  const mysql = await import('mysql2/promise');
  let root;
  try {
    root = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3307,
      user: 'root',
      password: '',
      connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_restore');
  await root.query('CREATE DATABASE cms_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_restore',
  });
  try {
    await ensureCmsSchema(db);
    const first = await saveContent(db, {
      cid: 40,
      baseRevision: 0,
      title: '第一版',
      slug: 'rev-40',
      text: '<!--markdown-->第一版正文\n',
      fields: [{ name: 'note', type: 'str', str_value: '第一版', int_value: null, float_value: null }],
      relationshipMids: [1],
    });
    assert.equal(first.ok, true);
    const second = await saveContent(db, {
      cid: 40,
      baseRevision: 1,
      title: '第二版',
      slug: 'rev-40-b',
      text: '<!--markdown-->第二版正文\n',
      fields: [{ name: 'note', type: 'str', str_value: '第二版', int_value: null, float_value: null }],
      relationshipMids: [1, 2],
    });
    assert.equal(second.revision, 2);

    const stale = await restoreContentRevision(db, { cid: 40, baseRevision: 1, revision: 1 });
    assert.equal(stale.status, 409);
    assert.equal((await getContent(db, 40)).text, '<!--markdown-->第二版正文\n');

    const restored = await restoreContentRevision(db, { cid: 40, baseRevision: 2, revision: 1 });
    assert.equal(restored.ok, true);
    assert.equal(restored.revision, 3);
    const current = await getContent(db, 40);
    assert.equal(current.text, '<!--markdown-->第一版正文\n');
    assert.equal(current.title, '第一版');
    assert.equal(current.slug, 'rev-40');
    assert.equal(current.revision, 3);
    const [fields] = await db.query(`SELECT str_value FROM cms_fields WHERE cid = 40 AND name = 'note'`);
    assert.equal(fields[0].str_value, '第一版');
    const [mids] = await db.query('SELECT mid FROM cms_relationships WHERE cid = 40 ORDER BY mid');
    assert.deepEqual(mids.map((row) => Number(row.mid)), [1]);
    const [history] = await db.query(
      'SELECT text FROM cms_content_revisions WHERE cid = 40 AND revision = 2',
    );
    assert.equal(history[0].text.toString('utf8'), '<!--markdown-->第二版正文\n');
    const [state] = await db.query(
      'SELECT source_revision, source_hash FROM cms_i18n_source_state WHERE cid = 40',
    );
    assert.equal(Number(state[0].source_revision), 3);
    assert.equal(state[0].source_hash, sourceHash('第一版', '<!--markdown-->第一版正文\n'));
    const [event] = await db.query(
      `SELECT op FROM cms_publish_outbox WHERE idem_key = 'content:40:rev:3:update'`,
    );
    assert.equal(event[0].op, 'update');
    const [job] = await db.query(
      `SELECT expected_source_hash FROM cms_i18n_translation_job
       WHERE cid = 40 AND expected_source_revision = 3`,
    );
    assert.equal(job[0].expected_source_hash, state[0].source_hash);

    const missing = await restoreContentRevision(db, { cid: 40, baseRevision: 3, revision: 9 });
    assert.equal(missing.status, 404);
    assert.equal((await getContent(db, 40)).text, '<!--markdown-->第一版正文\n');

    const moment = await saveContent(db, {
      cid: 41,
      baseRevision: 0,
      title: '闲话',
      slug: 'moment-41',
      text: '闲话第一版',
      fields: [{ name: 'content_kind', type: 'str', str_value: 'moment', int_value: null, float_value: null }],
    });
    assert.equal(moment.ok, true);
    await saveContent(db, {
      cid: 41,
      baseRevision: 1,
      title: '闲话',
      slug: 'moment-41',
      text: '闲话第二版',
      fields: [{ name: 'content_kind', type: 'str', str_value: 'moment', int_value: null, float_value: null }],
    });
    const momentRestored = await restoreContentRevision(db, { cid: 41, baseRevision: 2, revision: 1 });
    assert.equal(momentRestored.ok, true);
    assert.equal((await getContent(db, 41)).text, '闲话第一版');
    const [momentJobs] = await db.query('SELECT COUNT(*) AS n FROM cms_i18n_translation_job WHERE cid = 41');
    assert.equal(Number(momentJobs[0].n), 0);
  } finally {
    await db.end();
  }
});
