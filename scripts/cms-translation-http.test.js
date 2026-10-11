import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyBootstrap } from '../cms/src/lib/import-apply.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';
const fixtureDir = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/tables');

function loadPackage() {
  const names = [
    'contents', 'metas', 'relationships', 'fields',
    'i18n_source_state', 'i18n_translation_head', 'i18n_translation_version',
    'i18n_translation_job', 'i18n_publish_outbox', 'i18n_publication_ledger', 'i18n_migrations',
  ];
  return Object.fromEntries(names.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), 'utf8')),
  ]));
}

test('translation approval is a logged-in write and stays off the generic queue', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_i18nhttp');
  await root.query('CREATE DATABASE cms_i18nhttp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_i18nhttp.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_i18nhttp',
  });
  await ensureCmsSchema(setup);
  await applyBootstrap(setup, loadPackage(), { packageId: 'positive', source: 'i18n-http' });
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomBytes(16).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  const rebindToken = crypto.randomBytes(16).toString('base64url');
  const rebindCsrf = crypto.randomBytes(16).toString('base64url');
  await setup.query(
    `INSERT INTO cms_auth_sessions
      (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at, purpose)
     VALUES (?, 'i18n-test', ?, ?, ?, ?, ?, 'full'),
            (?, 'i18n-test', ?, ?, ?, ?, ?, 'rebind')`,
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
  process.env.CMS_DB_NAME = 'cms_i18nhttp';
  const { GET, POST } = await import('../cms/src/pages/api/translations.js');
  const { onRequest } = await import('../cms/src/middleware.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'cms', password: 'cms-dev', database: 'cms_i18nhttp',
  });
  const draft = loadPackage().i18n_translation_version.find((row) => row.version_id === 11);
  const headers = {
    origin,
    'content-type': 'application/json',
    cookie: `__Host-cms=${token}`,
    'x-csrf-token': csrf,
  };
  async function through(body, extraHeaders = headers) {
    const request = new Request('http://127.0.0.1:4322/api/translations', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(body),
    });
    return onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request,
    }, () => POST({ request }));
  }
  async function read(extraHeaders = headers) {
    const request = new Request('http://127.0.0.1:4322/api/translations?cid=2&locale=en', {
      headers: extraHeaders,
    });
    return onRequest({
      clientAddress: '127.0.0.1',
      locals: {},
      request,
    }, () => GET({ request, url: new URL(request.url) }));
  }
  try {
    const hidden = await read({});
    const hiddenText = await hidden.text();
    assert.equal(hidden.status, 401, hiddenText);
    assert.equal(hiddenText.includes('Draft body'), false);
    const mismatch = await through({
      action: 'approve', cid: 2, locale: 'en', versionId: 11, digest: 'a'.repeat(64), proofreader: 'human:1',
    });
    assert.equal(mismatch.status, 409);
    const [still] = await db.query(
      `SELECT approved_version_id FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(Number(still[0].approved_version_id), 10);

    const approved = await through({
      action: 'approve', cid: 2, locale: 'en', versionId: 11,
      digest: draft.content_digest, proofreader: 'human:1',
    });
    const approvedText = await approved.text();
    assert.equal(approved.status, 200, approvedText);
    assert.equal(JSON.parse(approvedText).approvedVersionId, 11);
    const [head] = await db.query(
      `SELECT approved_version_id FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(Number(head[0].approved_version_id), 11);
    const [events] = await db.query(
      `SELECT status FROM cms_i18n_publish_outbox WHERE idem_key = 'publish:2:en:11'`,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].status, 'pending');
    const [generic] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox');
    assert.equal(Number(generic[0].n), 0);

    const rebind = await through({
      action: 'approve', cid: 2, locale: 'en', versionId: 10,
      digest: 'b'.repeat(64), proofreader: 'human:1',
    }, {
      origin,
      'content-type': 'application/json',
      cookie: `__Host-cms=${rebindToken}`,
      'x-csrf-token': rebindCsrf,
    });
    assert.equal(rebind.status, 403);
    assert.equal(await rebind.text(), 'rebind session cannot write');
    const [afterRebind] = await db.query(
      `SELECT approved_version_id FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(Number(afterRebind[0].approved_version_id), 11);

    const disabled = await through({ action: 'publication', cid: 2, locale: 'en', state: 'disabled' });
    assert.equal(disabled.status, 200, await disabled.clone().text());
    const [state] = await db.query(
      `SELECT publication_state FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(state[0].publication_state, 'disabled');
    const [cancelled] = await db.query(
      `SELECT status FROM cms_i18n_publish_outbox WHERE idem_key = 'publish:2:en:11'`,
    );
    assert.equal(cancelled[0].status, 'cancelled');
    const listed = await read();
    const listedText = await listed.text();
    assert.equal(listed.status, 200, listedText);
    const list = JSON.parse(listedText);
    assert.equal(list.publicationState, 'disabled');
    assert.equal(list.approvedVersionId, 11);
    const draftRow = list.versions.find((row) => row.versionId === 11);
    assert.equal(draftRow.body, 'Draft body\n');
    assert.equal(draftRow.contentDigest, draft.content_digest);
  } finally {
    await db.end();
    await closeCmsDb();
  }
});
