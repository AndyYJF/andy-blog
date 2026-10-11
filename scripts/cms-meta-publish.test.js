import assert from 'node:assert/strict';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { deleteMeta, saveMeta } from '../cms/src/lib/meta-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('a public category change enters the generic queue only', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_meta');
  await root.query('CREATE DATABASE cms_meta CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_meta',
  });
  try {
    await ensureCmsSchema(db);
    const created = await saveMeta(db, { name: '分类', slug: 'cat-a', type: 'category' });
    assert.equal(created.ok, true, created.error);
    assert.equal(created.enqueued, false);
    const [none] = await db.query(`SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE op = 'meta'`);
    assert.equal(Number(none[0].n), 0);

    const draft = await saveContent(db, {
      cid: 2, baseRevision: 0, title: '草稿', slug: 'draft', text: '<!--markdown-->草稿\n', type: 'post_draft',
    });
    assert.equal(draft.ok, true, draft.error);
    const secret = await saveContent(db, {
      cid: 3, baseRevision: 0, title: '密码', slug: 'secret', text: '<!--markdown-->密码\n', password: 'secret',
    });
    assert.equal(secret.ok, true, secret.error);
    const post = await saveContent(db, {
      cid: 1, baseRevision: 0, title: '正文', slug: 'post', text: '<!--markdown-->正文\n',
    });
    assert.equal(post.ok, true, post.error);

    await db.query('INSERT INTO cms_relationships (cid, mid) VALUES (2, ?), (3, ?)', [created.mid, created.mid]);
    const hidden = await saveMeta(db, {
      mid: created.mid, baseSlug: 'cat-a', name: '草稿分类', slug: 'cat-b', type: 'category',
    });
    assert.equal(hidden.ok, true, hidden.error);
    assert.equal(hidden.enqueued, false);

    await db.query('INSERT INTO cms_relationships (cid, mid) VALUES (1, ?)', [created.mid]);
    const visible = await saveMeta(db, {
      mid: created.mid, baseSlug: 'cat-b', name: '公开分类', slug: 'cat-c', type: 'category',
    });
    assert.equal(visible.enqueued, true);
    const [metaEvent] = await db.query(
      `SELECT cid, mid, op FROM cms_publish_outbox WHERE op = 'meta'`,
    );
    assert.equal(metaEvent.length, 1);
    assert.equal(metaEvent[0].cid, null);
    assert.equal(Number(metaEvent[0].mid), created.mid);
    const [translated] = await db.query('SELECT COUNT(*) AS n FROM cms_i18n_publish_outbox');
    assert.equal(Number(translated[0].n), 0);

    const stale = await saveMeta(db, {
      mid: created.mid, baseSlug: 'cat-b', name: '过期', slug: 'cat-d', type: 'category',
    });
    assert.equal(stale.status, 409);
    const [name] = await db.query('SELECT name FROM cms_metas WHERE mid = ?', [created.mid]);
    assert.equal(name[0].name, '公开分类');

    const noted = await saveContent(db, {
      cid: 1,
      baseRevision: 1,
      title: '正文',
      slug: 'post',
      text: '<!--markdown-->正文\n',
      fields: [{ name: 'legacy_note', type: 'str', str_value: '字段', int_value: null, float_value: null }],
    });
    assert.equal(noted.ok, true, noted.error);
    const [fieldEvent] = await db.query(
      `SELECT op FROM cms_publish_outbox WHERE idem_key = 'content:1:rev:2:update'`,
    );
    assert.equal(fieldEvent[0].op, 'update');

    const removed = await deleteMeta(db, { mid: created.mid, baseSlug: 'cat-c' });
    assert.equal(removed.enqueued, true);
    const [links] = await db.query('SELECT COUNT(*) AS n FROM cms_relationships WHERE mid = ?', [created.mid]);
    assert.equal(Number(links[0].n), 0);
    const [still] = await db.query('SELECT COUNT(*) AS n FROM cms_contents WHERE cid = 1');
    assert.equal(Number(still[0].n), 1);
    const [events] = await db.query(`SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE op = 'meta'`);
    assert.equal(Number(events[0].n), 2);
    const [log] = await db.query(
      `SELECT op FROM cms_change_log WHERE table_name = 'cms_metas' AND mid = ? ORDER BY log_id`,
      [created.mid],
    );
    assert.deepEqual(log.map((row) => row.op), ['insert', 'update', 'update', 'delete']);

    await db.query(
      `INSERT INTO cms_runtime (id, mode, updated_at) VALUES (1, 'shadow', 1)`,
    );
    const blocked = await saveMeta(db, { name: '影子', slug: 'shadow', type: 'tag' });
    assert.equal(blocked.status, 403);
  } finally {
    await db.end();
  }
});
