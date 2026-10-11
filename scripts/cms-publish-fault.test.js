import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCmsSchema, saveContent } from '../cms/src/lib/content-store.js';
import { applyDelivery, claimDue, deliverClaimed, markDelivery } from '../cms/src/lib/publish-outbox.js';

test('a crashed delivery keeps the event and a late 202 cannot take another lease', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_fault');
  await root.query('CREATE DATABASE cms_fault CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_fault',
  });
  try {
    await ensureCmsSchema(db);
    const saved = await saveContent(db, {
      cid: 60,
      baseRevision: 0,
      title: '发布',
      slug: 'publish-60',
      text: '<!--markdown-->公开正文\n',
    });
    assert.equal(saved.ok, true);
    const now = Math.floor(Date.now() / 1000);
    const claimed = await claimDue(db, { owner: 'worker-a', now, leaseSeconds: 30 });
    assert.equal(claimed.length, 1);
    const eventId = claimed[0].event_id;

    const reclaimed = await claimDue(db, { owner: 'worker-b', now: now + 31, leaseSeconds: 30 });
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].event_id, eventId);
    const late = await markDelivery(
      db,
      eventId,
      applyDelivery({ status: 202, attempts: 0, now: now + 31 }),
      now + 31,
      'worker-a',
    );
    assert.equal(late, false);
    const [held] = await db.query(
      'SELECT status, lease_owner FROM cms_publish_outbox WHERE event_id = ?',
      [eventId],
    );
    assert.equal(held[0].status, 'sending');
    assert.equal(held[0].lease_owner, 'worker-b');

    const lost = await deliverClaimed(reclaimed, {
      now: now + 31,
      owner: 'worker-b',
      db,
      nonceFor: () => 'aa'.repeat(16),
      send: async () => {
        throw new Error('response lost');
      },
    });
    assert.equal(lost[0].eventId, eventId);
    assert.equal(lost[0].recorded, true);
    assert.equal(lost[0].status, 'pending');
    const [kept] = await db.query(
      'SELECT status, attempts FROM cms_publish_outbox WHERE event_id = ?',
      [eventId],
    );
    assert.equal(kept[0].status, 'pending');
    assert.equal(Number(kept[0].attempts), 1);

    const retryClaim = await claimDue(db, { owner: 'worker-b', now: now + 120, leaseSeconds: 30 });
    assert.equal(retryClaim[0].event_id, eventId);
    const accepted = await deliverClaimed(retryClaim, {
      now: now + 120,
      owner: 'worker-b',
      db,
      nonceFor: () => 'bb'.repeat(16),
      send: async () => 202,
    });
    assert.equal(accepted[0].recorded, true);
    assert.equal(accepted[0].status, 'accepted');
    assert.equal(accepted[0].eventId, eventId);
    assert.notEqual(accepted[0].nonce, lost[0].nonce);
    const quiet = await claimDue(db, { owner: 'worker-c', now: now + 121, leaseSeconds: 30 });
    assert.equal(quiet.length, 0);
    const [done] = await db.query('SELECT status FROM cms_publish_outbox WHERE event_id = ?', [eventId]);
    assert.equal(done[0].status, 'accepted');

    const edited = await saveContent(db, {
      cid: 60,
      baseRevision: 1,
      title: '发布',
      slug: 'publish-60',
      text: '<!--markdown-->再改一版\n',
    });
    assert.equal(edited.ok, true);
    const protocolClaim = await claimDue(db, { owner: 'worker-b', now: now + 200, leaseSeconds: 30 });
    assert.equal(protocolClaim.length, 1);
    const rejected = await deliverClaimed(protocolClaim, {
      now: now + 200,
      owner: 'worker-b',
      db,
      nonceFor: () => 'cc'.repeat(16),
      send: async () => 400,
    });
    assert.equal(rejected[0].status, 'failed');
    const [failed] = await db.query(
      'SELECT status FROM cms_publish_outbox WHERE event_id = ?',
      [protocolClaim[0].event_id],
    );
    assert.equal(failed[0].status, 'failed');
    const again = await claimDue(db, { owner: 'worker-b', now: now + 201, leaseSeconds: 30 });
    assert.equal(again.length, 0);
    const [rows] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE cid = 60');
    assert.equal(Number(rows[0].n), 2);
  } finally {
    await db.end();
  }
});
