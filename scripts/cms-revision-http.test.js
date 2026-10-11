import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';

function session(token, csrf) {
  return {
    cookie: `__Host-cms=${token}`,
    'x-csrf-token': csrf,
  };
}

test('restoring a revision goes through the write session and keeps the older text', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_revhttp');
  await root.query('CREATE DATABASE cms_revhttp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_revhttp.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_revhttp',
  });
  await ensureCmsSchema(setup);
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomBytes(16).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  const rebindToken = crypto.randomBytes(16).toString('base64url');
  const rebindCsrf = crypto.randomBytes(16).toString('base64url');
  await setup.query(
    `INSERT INTO cms_auth_sessions
      (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at, purpose)
     VALUES (?, 'restore-test', ?, ?, ?, ?, ?, 'full'),
            (?, 'restore-test', ?, ?, ?, ?, ?, 'rebind')`,
    [
      crypto.createHash('sha256').update(token).digest('hex'), now, now + 3600, now + 3600,
      crypto.createHash('sha256').update(csrf).digest('hex'), now,
      crypto.createHash('sha256').update(rebindToken).digest('hex'), now, now + 600, now + 600,
      crypto.createHash('sha256').update(rebindCsrf).digest('hex'), now,
    ],
  );
  await setup.end();
  await root.end();

  process.env.CMS_DB_HOST = '127.0.0.1';
  process.env.CMS_DB_PORT = '3307';
  process.env.CMS_DB_USER = 'cms';
  process.env.CMS_DB_PASSWORD = 'cms-dev';
  process.env.CMS_DB_NAME = 'cms_revhttp';
  const route = await import('../cms/src/pages/api/contents/[cid].js');
  const { onRequest } = await import('../cms/src/middleware.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'cms', password: 'cms-dev', database: 'cms_revhttp',
  });
  const headers = { origin, 'content-type': 'application/json', ...session(token, csrf) };
  async function through(method, body) {
    const request = new Request('http://127.0.0.1:4322/api/contents/8', {
      method,
      headers,
      body: JSON.stringify(body),
    });
    return onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request,
    }, () => {
      const params = { cid: '8' };
      if (method === 'PUT') return route.PUT({ params, request });
      return route.POST({ params, request });
    });
  }
  try {
    const created = await through('PUT', {
      text: '<!--markdown-->第一版\n',
      baseRevision: 0,
      title: '修订',
      slug: 'rev-http',
      type: 'post',
      status: 'publish',
    });
    assert.equal(created.status, 200, await created.clone().text());
    const updated = await through('PUT', {
      text: '<!--markdown-->第二版\n',
      baseRevision: 1,
      title: '修订',
      slug: 'rev-http',
    });
    assert.equal(updated.status, 200, await updated.clone().text());
    const restored = await through('POST', { baseRevision: 2, revision: 1 });
    const restoredText = await restored.text();
    assert.equal(restored.status, 200, restoredText);
    const body = JSON.parse(restoredText);
    assert.equal(body.revision, 3);
    assert.equal(body.restoredFrom, 1);
    assert.equal(restoredText.includes('password'), false);
    const [row] = await db.query('SELECT text, revision FROM cms_contents WHERE cid = 8');
    assert.equal(row[0].text, '<!--markdown-->第一版\n');
    assert.equal(Number(row[0].revision), 3);
    const [event] = await db.query(
      `SELECT op, status FROM cms_publish_outbox WHERE cid = 8 ORDER BY event_id DESC LIMIT 1`,
    );
    assert.equal(event[0].op, 'update');
    assert.notEqual(event[0].status, 'accepted');

    const stale = await through('POST', { baseRevision: 2, revision: 1 });
    assert.equal(stale.status, 409);
    const [still] = await db.query('SELECT text, revision FROM cms_contents WHERE cid = 8');
    assert.equal(still[0].text, '<!--markdown-->第一版\n');
    assert.equal(Number(still[0].revision), 3);

    const rebind = await onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request: new Request('http://127.0.0.1:4322/api/contents/8', {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          ...session(rebindToken, rebindCsrf),
        },
        body: JSON.stringify({ baseRevision: 3, revision: 2 }),
      }),
    }, () => { throw new Error('rebind reached restore'); });
    assert.equal(rebind.status, 403);
    assert.equal(await rebind.text(), 'rebind session cannot write');
    const [afterRebind] = await db.query('SELECT revision FROM cms_contents WHERE cid = 8');
    assert.equal(Number(afterRebind[0].revision), 3);
  } finally {
    await db.end();
    await closeCmsDb();
  }
});
