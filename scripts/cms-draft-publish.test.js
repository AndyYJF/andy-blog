import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCmsSchema, saveContent } from '../cms/src/lib/content-store.js';

test('a draft does not enqueue, and unpublish does', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_draft');
  await root.query('CREATE DATABASE cms_draft CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_draft',
  });
  try {
    await ensureCmsSchema(db);
    const draft = await saveContent(db, {
      cid: 70,
      baseRevision: 0,
      title: '草稿',
      slug: 'draft-70',
      text: '<!--markdown-->草稿\n',
      type: 'post_draft',
      status: 'publish',
    });
    assert.equal(draft.ok, true);
    const [none] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE cid = 70');
    assert.equal(Number(none[0].n), 0);
    const [noJob] = await db.query('SELECT COUNT(*) AS n FROM cms_i18n_translation_job WHERE cid = 70');
    assert.equal(Number(noJob[0].n), 0);

    const secret = await saveContent(db, {
      cid: 71,
      baseRevision: 0,
      title: '密码',
      slug: 'secret-71',
      text: '<!--markdown-->密码\n',
      type: 'post',
      status: 'publish',
      password: 'secret',
    });
    assert.equal(secret.ok, true);
    const [secretEvents] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE cid = 71');
    assert.equal(Number(secretEvents[0].n), 0);

    const published = await saveContent(db, {
      cid: 70,
      baseRevision: 1,
      title: '草稿',
      slug: 'draft-70',
      text: '<!--markdown-->草稿\n',
      type: 'post',
      status: 'publish',
    });
    assert.equal(published.ok, true);
    const [pub] = await db.query(
      `SELECT op FROM cms_publish_outbox WHERE idem_key = 'content:70:rev:2:publish'`,
    );
    assert.equal(pub[0].op, 'publish');

    const hidden = await saveContent(db, {
      cid: 70,
      baseRevision: 2,
      title: '草稿',
      slug: 'draft-70',
      text: '<!--markdown-->撤回\n',
      type: 'post',
      status: 'hidden',
    });
    assert.equal(hidden.ok, true);
    const [withdrawn] = await db.query(
      `SELECT op FROM cms_publish_outbox WHERE idem_key = 'content:70:rev:3:unpublish'`,
    );
    assert.equal(withdrawn[0].op, 'unpublish');
    const [jobs] = await db.query(
      `SELECT status FROM cms_i18n_translation_job WHERE cid = 70`,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'cancelled');
    const bad = await saveContent(db, {
      cid: 72,
      baseRevision: 0,
      title: '坏',
      slug: 'bad',
      text: 'x',
      type: 'widget',
    });
    assert.equal(bad.status, 400);
    const [rows] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE cid = 70');
    assert.equal(Number(rows[0].n), 2);
  } finally {
    await db.end();
  }
});
