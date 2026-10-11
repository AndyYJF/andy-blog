import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { approveTranslation } from '../cms/src/lib/i18n-edit.js';
import { ensureCmsSchema } from '../cms/src/lib/content-store.js';
import { applyBootstrap } from '../cms/src/lib/import-apply.js';

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

test('approval moves the pointer only when the digest matches', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_approve');
  await root.query('CREATE DATABASE cms_approve CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_approve',
  });
  try {
  await ensureCmsSchema(db);
  await applyBootstrap(db, loadPackage(), { packageId: 'positive', source: 'approve-test' });

  const draft = loadPackage().i18n_translation_version.find((row) => row.version_id === 11);
  const [ledgerBefore] = await db.query(
    `SELECT translation_available_at FROM cms_i18n_publication_ledger WHERE cid = 2 AND locale = 'en'`,
  );
  const original = ledgerBefore[0].translation_available_at;

  const mismatch = await approveTranslation(db, {
    cid: 2, locale: 'en', versionId: 11, digest: 'a'.repeat(64), proofreader: 'human:1',
  });
  assert.equal(mismatch.status, 409);
  const [still] = await db.query(
    `SELECT approved_version_id FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
  );
  assert.equal(Number(still[0].approved_version_id), 10);

  const approved = await approveTranslation(db, {
    cid: 2, locale: 'en', versionId: 11, digest: draft.content_digest, proofreader: 'human:1',
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.approvedVersionId, 11);
  const [head] = await db.query(
    `SELECT approved_version_id, equivalence_state FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
  );
  assert.equal(Number(head[0].approved_version_id), 11);
  assert.equal(head[0].equivalence_state, 'not_equivalent');
  const [stamped] = await db.query(
    `SELECT proofreader FROM cms_i18n_translation_version WHERE version_id = 11`,
  );
  assert.equal(stamped[0].proofreader, 'human:1');
  const [events] = await db.query(
    `SELECT status FROM cms_i18n_publish_outbox WHERE idem_key = 'publish:2:en:11'`,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'pending');

  await approveTranslation(db, {
    cid: 2, locale: 'en', versionId: 11, digest: draft.content_digest, proofreader: 'human:1',
  });
  const [eventsAgain] = await db.query(
    `SELECT COUNT(*) AS n FROM cms_i18n_publish_outbox WHERE idem_key = 'publish:2:en:11'`,
  );
  assert.equal(Number(eventsAgain[0].n), 1);
  const [ledgerAfter] = await db.query(
    `SELECT translation_available_at FROM cms_i18n_publication_ledger WHERE cid = 2 AND locale = 'en'`,
  );
  assert.equal(Number(ledgerAfter[0].translation_available_at), Number(original));

  const missing = await approveTranslation(db, {
    cid: 2, locale: 'en', versionId: 99, digest: draft.content_digest, proofreader: 'human:1',
  });
  assert.equal(missing.status, 404);
  const bad = await approveTranslation(db, {
    cid: 2, locale: 'en', versionId: 11, digest: 'nope', proofreader: 'human:1',
  });
  assert.equal(bad.status, 400);
  } finally {
    await db.end();
  }
});
