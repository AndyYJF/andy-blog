import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import test from 'node:test';
import { MOCK_IMAGE_MAX_BYTES } from '../cms/src/lib/media-mock.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';
const sharp = createRequire(new URL('../cms/package.json', import.meta.url))('sharp');
const jpeg = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 10, g: 20, b: 30 } },
}).jpeg().toBuffer();

function sessionCookie(token) {
  return `__Host-cms=${token}`;
}

test('image upload requires a session and stores only the unverified mock', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_mediahttp');
  await root.query('CREATE DATABASE cms_mediahttp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_mediahttp.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_mediahttp',
  });
  await ensureCmsSchema(setup);
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomBytes(16).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  await setup.query(
    `INSERT INTO cms_auth_sessions
      (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at, purpose)
     VALUES (?, 'upload-test', ?, ?, ?, ?, ?, 'full')`,
    [
      crypto.createHash('sha256').update(token).digest('hex'),
      now,
      now + 3600,
      now + 3600,
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
  process.env.CMS_DB_NAME = 'cms_mediahttp';
  const { POST } = await import('../cms/src/pages/api/media.js');
  const { onRequest } = await import('../cms/src/middleware.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_mediahttp',
  });
  const headers = {
    origin,
    cookie: sessionCookie(token),
    'x-csrf-token': csrf,
    'content-type': 'application/octet-stream',
  };
  async function through(request) {
    return onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request,
    }, () => POST({ request }));
  }
  try {
    const anonymous = await through(new Request('http://127.0.0.1:4322/api/media', {
      method: 'POST', headers: { origin, 'content-type': 'application/octet-stream' }, body: jpeg,
    }));
    assert.equal(anonymous.status, 401);
    const wrong = await through(new Request('http://127.0.0.1:4322/api/media', {
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': 'nope' },
      body: jpeg,
    }));
    assert.equal(wrong.status, 403);
    const svg = await through(new Request('http://127.0.0.1:4322/api/media', {
      method: 'POST', headers, body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    }));
    assert.equal(svg.status, 400);
    const oversized = Buffer.alloc(MOCK_IMAGE_MAX_BYTES + 1, 0xff);
    const tooBig = await through(new Request('http://127.0.0.1:4322/api/media', {
      method: 'POST', headers, body: oversized,
    }));
    assert.equal(tooBig.status, 413);
    const stored = await through(new Request('http://127.0.0.1:4322/api/media', {
      method: 'POST', headers, body: jpeg,
    }));
    const storedText = await stored.text();
    assert.equal(stored.status, 200, storedText);
    const body = JSON.parse(storedText);
    assert.equal(body.provider, 'unverified');
    assert.match(body.url, /^mock:\/\/unverified\//);
    assert.equal(body.width, 1);
    assert.equal(body.height, 1);
    const again = await through(new Request('http://127.0.0.1:4322/api/media', {
      method: 'POST', headers, body: jpeg,
    }));
    const duplicate = JSON.parse(await again.text());
    assert.equal(duplicate.deduped, true);
    assert.equal(duplicate.mediaId, body.mediaId);
    const [rows] = await db.query('SELECT url, width FROM cms_media');
    const [audit] = await db.query(`SELECT detail FROM cms_audit_log WHERE action = 'media.store'`);
    assert.equal(rows.length, 1);
    assert.match(rows[0].url, /^mock:\/\/unverified\//);
    assert.equal(Number(rows[0].width), 1);
    assert.equal(String(audit[0].detail).includes(jpeg.toString('base64')), false);
  } finally {
    await closeCmsDb();
    await db.end();
  }
});
