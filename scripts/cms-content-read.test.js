import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';

test('reading a content row requires a session and hides the text until then', async (t) => {
  const editor = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/editor/mount.js'), 'utf8');
  assert.match(editor, /需要登录。这篇正文没有读出。/);
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
  await root.query('DROP DATABASE IF EXISTS cms_readhttp');
  await root.query('CREATE DATABASE cms_readhttp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_readhttp.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_readhttp',
  });
  await ensureCmsSchema(setup);
  const saved = await saveContent(setup, {
    cid: 3,
    baseRevision: 0,
    title: '私密',
    slug: 'secret-read',
    text: '<!--markdown-->私密正文MARKER\n',
    type: 'post',
    status: 'private',
    password: 'hidden-pass',
  });
  assert.equal(saved.ok, true, saved.error);
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomBytes(16).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  await setup.query(
    `INSERT INTO cms_auth_sessions
      (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at, purpose)
     VALUES (?, 'read-test', ?, ?, ?, ?, ?, 'full')`,
    [
      crypto.createHash('sha256').update(token).digest('hex'),
      now, now + 3600, now + 3600,
      crypto.createHash('sha256').update(csrf).digest('hex'),
      now,
    ],
  );
  await setup.end();
  await root.end();

  process.env.CMS_DB_HOST = '127.0.0.1';
  process.env.CMS_DB_PORT = '3307';
  process.env.CMS_DB_USER = 'cms';
  process.env.CMS_DB_PASSWORD = 'cms-dev';
  process.env.CMS_DB_NAME = 'cms_readhttp';
  const { GET } = await import('../cms/src/pages/api/contents/[cid].js');
  const { onRequest } = await import('../cms/src/middleware.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  async function read(headers) {
    const request = new Request('http://127.0.0.1:4322/api/contents/3?export=1', { headers });
    return onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request,
    }, () => GET({ params: { cid: '3' }, request, url: new URL(request.url) }));
  }
  try {
    const hidden = await read({ origin });
    const hiddenText = await hidden.text();
    assert.equal(hidden.status, 401, hiddenText);
    assert.equal(hiddenText.includes('私密正文MARKER'), false);
    assert.equal(hiddenText.includes('hidden-pass'), false);
    const shown = await read({
      origin,
      cookie: `__Host-cms=${token}`,
      'x-csrf-token': csrf,
    });
    const shownText = await shown.text();
    assert.equal(shown.status, 200, shownText);
    assert.equal(shownText.includes('私密正文MARKER'), true);
    assert.equal(shownText.includes('hidden-pass'), true);
  } finally {
    await closeCmsDb();
  }
});
