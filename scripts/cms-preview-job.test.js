import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';

test('a formal preview request is only a local simulation', async (t) => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/lib/preview-job.js'), 'utf8');
  assert.equal(source.includes('fetch('), false);
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
  await root.query('DROP DATABASE IF EXISTS cms_previewhttp');
  await root.query('CREATE DATABASE cms_previewhttp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_previewhttp.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_previewhttp',
  });
  await ensureCmsSchema(setup);
  const saved = await saveContent(setup, {
    cid: 4,
    baseRevision: 0,
    title: '预览',
    slug: 'preview-job',
    text: '<!--markdown-->预览正文\n',
    type: 'post',
    status: 'publish',
  });
  assert.equal(saved.ok, true, saved.error);
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomBytes(16).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  const rebindToken = crypto.randomBytes(16).toString('base64url');
  const rebindCsrf = crypto.randomBytes(16).toString('base64url');
  await setup.query(
    `INSERT INTO cms_auth_sessions
      (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at, purpose)
     VALUES (?, 'preview-test', ?, ?, ?, ?, ?, 'full'),
            (?, 'preview-test', ?, ?, ?, ?, ?, 'rebind')`,
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
  process.env.CMS_DB_NAME = 'cms_previewhttp';
  const { POST } = await import('../cms/src/pages/api/preview-jobs.js');
  const { onRequest } = await import('../cms/src/middleware.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'cms', password: 'cms-dev', database: 'cms_previewhttp',
  });
  async function through(body, headers) {
    const request = new Request('http://127.0.0.1:4322/api/preview-jobs', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request,
    }, () => POST({ request }));
  }
  const session = { cookie: `__Host-cms=${token}`, 'x-csrf-token': csrf };
  try {
    const anonymous = await through({ cid: 4, baseRevision: 1 }, {});
    assert.equal(anonymous.status, 401);
    const [before] = await db.query(
      `SELECT COUNT(*) AS n FROM cms_audit_log WHERE action = 'preview.simulate'`,
    );
    assert.equal(Number(before[0].n), 0);

    const remote = await through({
      cid: 4, baseRevision: 1, endpoint: 'http://example.com/hooks/rebuild',
    }, session);
    assert.equal(remote.status, 400);
    const [afterRemote] = await db.query(
      `SELECT COUNT(*) AS n FROM cms_audit_log WHERE action = 'preview.simulate'`,
    );
    assert.equal(Number(afterRemote[0].n), 0);

    const [queueBefore] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox');
    const simulated = await through({ cid: 4, baseRevision: 1 }, session);
    const simulatedText = await simulated.text();
    assert.equal(simulated.status, 200, simulatedText);
    const body = JSON.parse(simulatedText);
    assert.equal(body.simulated, true);
    assert.equal(body.live, false);
    assert.equal(body.dist, null);
    assert.equal(simulatedText.includes('预览正文'), false);
    assert.equal(simulatedText.includes('已上线'), false);
    const [row] = await db.query('SELECT revision FROM cms_contents WHERE cid = 4');
    assert.equal(Number(row[0].revision), 1);
    const [queue] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox');
    assert.equal(Number(queue[0].n), Number(queueBefore[0].n));
    const [audit] = await db.query(
      `SELECT detail FROM cms_audit_log WHERE action = 'preview.simulate'`,
    );
    assert.equal(String(audit[0].detail).includes('预览正文'), false);

    const stale = await through({ cid: 4, baseRevision: 2 }, session);
    assert.equal(stale.status, 409);
    const rebind = await through({ cid: 4, baseRevision: 1 }, {
      cookie: `__Host-cms=${rebindToken}`,
      'x-csrf-token': rebindCsrf,
    });
    assert.equal(rebind.status, 403);
    assert.equal(await rebind.text(), 'rebind session cannot write');
  } finally {
    await db.end();
    await closeCmsDb();
  }
});
