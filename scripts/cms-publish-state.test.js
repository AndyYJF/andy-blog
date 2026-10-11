import assert from 'node:assert/strict';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { applyDelivery, markDelivery, readPublishState } from '../cms/src/lib/publish-outbox.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('an accepted rebuild request is still not a live revision', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_pubstate');
  await root.query('CREATE DATABASE cms_pubstate CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_pubstate',
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
    assert.deepEqual(await readPublishState(db, 1), {
      queue: null, op: null, requestAccepted: false, live: false,
    });

    const post = await saveContent(db, {
      cid: 2,
      baseRevision: 0,
      title: '正文',
      slug: 'post',
      text: '<!--markdown-->正文\n',
    });
    assert.equal(post.ok, true, post.error);
    const queued = await readPublishState(db, 2);
    assert.equal(queued.queue, 'pending');
    assert.equal(queued.op, 'publish');
    assert.equal(queued.requestAccepted, false);
    assert.equal(queued.live, false);

    await db.query(
      `UPDATE cms_publish_outbox
       SET status = 'sending', lease_owner = 'state-test', lease_until = 2000000000
       WHERE event_id = ?`,
      [queued.eventId],
    );
    const recorded = await markDelivery(
      db,
      queued.eventId,
      applyDelivery({ status: 202, attempts: 0, now: 1700000000 }),
      1700000000,
      'state-test',
    );
    assert.equal(recorded, true);
    const accepted = await readPublishState(db, 2);
    assert.equal(accepted.queue, 'accepted');
    assert.equal(accepted.requestAccepted, true);
    assert.equal(accepted.live, false);
    assert.equal(accepted.eventId, queued.eventId);
  } finally {
    await db.end();
  }
});
