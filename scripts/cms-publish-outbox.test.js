import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CMS_SCHEMA_SQL } from '../cms/src/lib/schema.js';
import { applyDelivery, publishChange, rebuildBody } from '../cms/src/lib/publish-outbox.js';
import { planBootstrap } from './lib/cms-import-plan.js';

const fixtureDir = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/tables');

function readTable(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function loadPackage() {
  return {
    contents: readTable('contents.json'),
    metas: readTable('metas.json'),
    relationships: readTable('relationships.json'),
    fields: readTable('fields.json'),
    i18n_publish_outbox: readTable('i18n_publish_outbox.json'),
    i18n_translation_version: readTable('i18n_translation_version.json'),
  };
}

test('generic publish queue is separate from the translation outbox', () => {
  const generic = CMS_SCHEMA_SQL.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS cms_publish_outbox'));
  const translated = CMS_SCHEMA_SQL.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS cms_i18n_publish_outbox'));
  assert.ok(generic);
  assert.ok(translated);
  assert.match(generic, /ENUM\('pending','sending','accepted','failed'\)/);
  assert.doesNotMatch(generic, /locale|version_id/);
  assert.match(translated, /locale VARCHAR/);
  assert.match(translated, /version_id BIGINT/);
});

test('only a public post or page change asks for a rebuild', () => {
  const draft = { type: 'post_draft', status: 'publish', password: null };
  const hidden = { type: 'post', status: 'hidden', password: null };
  const secret = { type: 'post', status: 'publish', password: 'secret' };
  const published = { type: 'post', status: 'publish', password: null };
  assert.equal(publishChange(null, draft), null);
  assert.equal(publishChange(draft, { ...draft, title: '改了' }), null);
  assert.equal(publishChange(null, hidden), null);
  assert.equal(publishChange(null, secret), null);
  assert.equal(publishChange(null, published).op, 'publish');
  assert.equal(publishChange(draft, published).op, 'publish');
  assert.equal(publishChange(published, { ...published, title: '改了' }).op, 'update');
  assert.equal(publishChange(published, hidden).op, 'unpublish');
  assert.equal(publishChange(published, null).op, 'delete');
});

test('delivery keeps the event id and only 202 is accepted', () => {
  const accepted = applyDelivery({ status: 202, attempts: 0, now: 100 });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.attempts, 1);
  const protocol = applyDelivery({ status: 401, attempts: 0, error: new Error('replay'), now: 100 });
  assert.equal(protocol.status, 'failed');
  const retry = applyDelivery({ status: 503, attempts: 0, error: new Error('down'), now: 100 });
  assert.equal(retry.status, 'pending');
  assert.ok(retry.nextRetryAt > 100);
  const exhausted = applyDelivery({ status: 503, attempts: 7, maxAttempts: 8, error: new Error('down'), now: 100 });
  assert.equal(exhausted.status, 'failed');
  const body = rebuildBody({ now: 100, nonce: 'ab'.repeat(16) });
  assert.equal(body.event, 'typecho-content-changed');
  assert.equal(Object.hasOwn(body, 'i18n'), false);
});

test('bootstrap keeps original bytes and does not copy translation events into the generic queue', () => {
  const source = loadPackage();
  const plan = planBootstrap(source);
  assert.equal(plan.cms_publish_outbox.length, 0);
  assert.equal(plan.i18n_publish_outbox.length, source.i18n_publish_outbox.length);
  for (const row of source.contents) {
    const copy = plan.contents.find((item) => item.cid === row.cid);
    assert.equal(copy.text, row.text);
    assert.equal(copy.password, row.password);
  }
  assert.ok(plan.autoIncrement.cid > Math.max(...source.contents.map((row) => row.cid)));
  const broken = structuredClone(source);
  broken.contents[0].type = 'widget';
  assert.throws(() => planBootstrap(broken), /unmapped content type/);
  const extra = structuredClone(source);
  extra.contents[0].unexpected = 1;
  assert.throws(() => planBootstrap(extra), /unmapped contents columns/);
});

test('a generic rebuild request is accepted once and a replay needs a new nonce', async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-publish-'));
  const secretFile = path.join(runtime, 'webhook_secret');
  fs.writeFileSync(secretFile, 'test-secret');
  process.env.RUNTIME_DIR = runtime;
  process.env.WEBHOOK_SECRET_FILE = secretFile;
  const { createServer, _internal } = await import('../docker/rebuild-api/server.js');
  await _internal.ensureRuntime();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const send = (nonce) => {
    const body = JSON.stringify(rebuildBody({ now: Math.floor(Date.now() / 1000), nonce }));
    const signature = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
    return fetch(`http://127.0.0.1:${port}/hooks/rebuild`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': `sha256=${signature}` },
      body,
    });
  };
  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const first = await send(nonce);
    assert.equal(first.status, 202);
    const queued = JSON.parse(fs.readFileSync(_internal.PATHS.pending, 'utf8'));
    assert.equal(Object.hasOwn(queued, 'i18n'), false);
    const replay = await send(nonce);
    assert.equal(replay.status, 401);
    const again = await send(crypto.randomBytes(16).toString('hex'));
    assert.equal(again.status, 202);
  } finally {
    server.close();
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});
