import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import { applyBootstrap, applyMirror, exportPackageTables } from '../cms/src/lib/import-apply.js';
import { applyRestore } from '../cms/src/lib/restore-typecho.js';
import { sha256Text } from '../cms/src/lib/content-store.js';
import { claimDue, deliverClaimed, enqueuePublish } from '../cms/src/lib/publish-outbox.js';
import { diffPackageTables } from './lib/cms-import-plan.js';
import { claimJob, sourceForJob, sourceHash } from './lib/i18n-store.js';

const fixtureDir = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/tables');

function readTable(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function loadPackage() {
  const names = [
    'contents', 'metas', 'relationships', 'fields',
    'i18n_source_state', 'i18n_translation_head', 'i18n_translation_version',
    'i18n_translation_job', 'i18n_publish_outbox', 'i18n_publication_ledger', 'i18n_migrations',
  ];
  return Object.fromEntries(names.map((name) => [name, readTable(`${name}.json`)]));
}

test('bootstrap import round-trips text on the isolated MySQL', async (t) => {
  const mysql = await import('mysql2/promise');
  let admin;
  try {
    admin = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3307,
      user: 'cms',
      password: 'cms-dev',
      database: 'cms_p2_test',
      charset: 'utf8mb4',
      connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  const source = loadPackage();
  try {
    await ensureCmsSchema(admin);
    await admin.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'cms_publish_outbox', 'cms_change_log', 'cms_import_runs', 'cms_content_revisions',
      'cms_contents', 'cms_metas', 'cms_relationships', 'cms_fields',
      'cms_i18n_source_state', 'cms_i18n_translation_head', 'cms_i18n_translation_version',
      'cms_i18n_translation_job', 'cms_i18n_publish_outbox', 'cms_i18n_publication_ledger',
      'cms_i18n_migrations',
    ]) {
      await admin.query(`DELETE FROM ${table}`);
    }
    const applied = await applyBootstrap(admin, source, {
      packageId: 'fixture-positive',
      source: 'synthetic-sanitized-fixture',
    });
    assert.equal(applied.autoIncrement.cid, 11);
    const exported = await exportPackageTables(admin);
    assert.equal(exported.cms_publish_outbox.length, 0);
    assert.equal(exported.i18n_publish_outbox.length, source.i18n_publish_outbox.length);
    const diffs = diffPackageTables(source, exported);
    const charDiffs = diffs.filter((diff) => (
      ['allowComment', 'allowPing', 'allowFeed'].includes(diff.column)
      && typeof diff.source === 'number'
      && typeof diff.exported === 'string'
      && String(diff.source) === diff.exported
    ));
    assert.deepEqual(diffs, charDiffs);
    const pool = mysql.createPool({
      host: '127.0.0.1',
      port: 3307,
      user: 'cms',
      password: 'cms-dev',
      database: 'cms_p2_test',
      charset: 'utf8mb4',
      connectionLimit: 2,
    });
    try {
      const claimed = await claimJob(pool, 'cms_', 'cms-worker');
      assert.equal(Number(claimed.cid), 2);
      assert.equal(claimed.status, 'leased');
      const sourceRow = await sourceForJob(pool, 'cms_', claimed);
      assert.equal(sourceHash(sourceRow.title, sourceRow.text), claimed.expected_source_hash);
      assert.equal(sourceHash(sourceRow.title, sourceRow.text), source.i18n_source_state[0].source_hash);
      const [storedRevision] = await admin.query('SELECT revision FROM cms_contents WHERE cid = 2');
      assert.equal(Number(storedRevision[0].revision), Number(claimed.expected_source_revision));
    } finally {
      await pool.end();
    }
    for (const row of source.contents) {
      const copy = exported.contents.find((item) => Number(item.cid) === row.cid);
      assert.equal(copy.text, row.text);
      assert.equal(copy.password, row.password);
      assert.equal(copy.title, row.title);
      assert.equal(copy.slug, row.slug);
      assert.equal(copy.type, row.type);
      assert.equal(copy.status, row.status);
      assert.equal(Number(copy.created), Number(row.created));
      assert.equal(Number(copy.modified), Number(row.modified));
      assert.equal(String(copy.allowComment), String(row.allowComment));
      assert.equal(copy.text_sha256, sha256Text(row.text == null ? '' : String(row.text)));
    }
    for (const row of source.i18n_translation_version) {
      const copy = exported.i18n_translation_version.find((item) => Number(item.version_id) === row.version_id);
      assert.equal(copy.body, row.body);
      assert.equal(copy.title, row.title);
      assert.equal(copy.source_hash, row.source_hash);
    }
    const mirrored = structuredClone(source);
    mirrored.contents = source.contents.filter((row) => row.cid !== 9);
    mirrored.relationships = source.relationships.filter((row) => row.cid !== 9);
    await applyMirror(admin, mirrored, { packageId: 'fixture-positive', source: 'synthetic-sanitized-fixture' });
    const afterDelete = await exportPackageTables(admin);
    assert.equal(afterDelete.contents.some((row) => Number(row.cid) === 9), false);
    assert.equal(afterDelete.relationships.some((row) => Number(row.cid) === 9), false);
    assert.equal(afterDelete.contents.find((row) => Number(row.cid) === 8).text, '<p>存量 HTML</p>');
    assert.equal(afterDelete.contents.find((row) => Number(row.cid) === 2).text, source.contents.find((row) => row.cid === 2).text);
    await applyMirror(admin, mirrored, { packageId: 'fixture-positive', source: 'synthetic-sanitized-fixture' });
    const again = await exportPackageTables(admin);
    assert.equal(again.contents.length, afterDelete.contents.length);
    const root = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3307,
      user: 'root',
      password: '',
    });
    await root.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
    await root.query("GRANT ALL PRIVILEGES ON typecho_restore.* TO 'cms'@'127.0.0.1'");
    await root.end();
    const restored = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3307,
      user: 'cms',
      password: 'cms-dev',
      database: 'typecho_restore',
      charset: 'utf8mb4',
    });
    try {
      await assert.rejects(() => applyRestore(admin, again), /refuses database cms/);
      await applyRestore(restored, again);
      await restored.query(
        `INSERT INTO typecho_contents
          (cid, title, slug, created, modified, text, type, status)
         VALUES (9, '复活', 'back', 1, 1, 'no', 'attachment', 'publish')`,
      );
      await applyRestore(restored, again);
      const [gone] = await restored.query('SELECT cid FROM typecho_contents WHERE cid = 9');
      assert.equal(gone.length, 0);
      const [html] = await restored.query('SELECT text FROM typecho_contents WHERE cid = 8');
      assert.equal(html[0].text, '<p>存量 HTML</p>');
      const [head] = await restored.query(
        `SELECT draft_version_id, approved_version_id
         FROM typecho_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
      );
      assert.equal(Number(head[0].draft_version_id), 11);
      assert.equal(Number(head[0].approved_version_id), 10);
    } finally {
      await restored.end();
    }
    await admin.query(
      `INSERT INTO cms_change_log (table_name, op, cid, created_at) VALUES ('cms_contents', 'update', 2, 1)`,
    );
    await assert.rejects(
      () => applyMirror(admin, mirrored, { packageId: 'fixture-positive', source: 'synthetic-sanitized-fixture' }),
      /CMS writes/,
    );
    await admin.query('DELETE FROM cms_change_log');
    const now = Math.floor(Date.now() / 1000);
    await admin.beginTransaction();
    await enqueuePublish(admin, { cid: 2, revision: 3, op: 'update', now });
    await admin.commit();
    const nonces = [];
    const firstClaim = await claimDue(admin, { owner: 'test', now, leaseSeconds: 30 });
    assert.equal(firstClaim.length, 1);
    const eventId = firstClaim[0].event_id;
    const firstTry = await deliverClaimed(firstClaim, {
      now,
      owner: 'test',
      db: admin,
      nonceFor: () => crypto.randomBytes(16).toString('hex'),
      send: async (body) => {
        const [rows] = await admin.query('SELECT status FROM cms_publish_outbox WHERE event_id = ?', [eventId]);
        assert.equal(rows[0].status, 'sending');
        const payload = JSON.parse(body);
        assert.equal(Object.hasOwn(payload, 'i18n'), false);
        nonces.push(payload.nonce);
        return 503;
      },
    });
    assert.equal(firstTry[0].eventId, eventId);
    assert.equal(firstTry[0].status, 'pending');
    const secondClaim = await claimDue(admin, { owner: 'test', now: now + 120, leaseSeconds: 30 });
    assert.equal(secondClaim[0].event_id, eventId);
    const secondTry = await deliverClaimed(secondClaim, {
      now: now + 120,
      owner: 'test',
      db: admin,
      nonceFor: () => crypto.randomBytes(16).toString('hex'),
      send: async (body) => {
        nonces.push(JSON.parse(body).nonce);
        return 202;
      },
    });
    assert.equal(secondTry[0].status, 'accepted');
    assert.equal(secondTry[0].eventId, eventId);
    assert.notEqual(nonces[0], nonces[1]);
    const [auto] = await admin.query(
      `SELECT AUTO_INCREMENT AS nextId FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'cms_contents'`,
    );
    assert.ok(Number(auto[0].nextId) > Math.max(...source.contents.map((row) => row.cid)));
    const [runs] = await admin.query(`SELECT status FROM cms_import_runs WHERE package_id = 'fixture-positive'`);
    assert.equal(runs[0].status, 'complete');
    await assert.rejects(
      () => applyBootstrap(admin, source, { packageId: 'again', source: 'synthetic-sanitized-fixture' }),
      /already has contents/,
    );
  } finally {
    await admin.end();
  }
});
