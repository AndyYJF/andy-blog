import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { deleteContent, ensureCmsSchema, getContent, saveContent } from '../cms/src/lib/content-store.js';
import { setTranslationPublication } from '../cms/src/lib/i18n-edit.js';
import { applyBootstrap, exportPackageTables } from '../cms/src/lib/import-apply.js';
import { applyRestore } from '../cms/src/lib/restore-typecho.js';
import { compareSnapshotData } from './lib/cms-contract.js';
import { readBuildSnapshot } from './lib/content-source.js';

const fixtureDir = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/tables');
const EPOCH = 1700000400;

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

test('CMS edits survive a freeze and do not resurrect on restore', async (t) => {
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
  await root.query('CREATE DATABASE IF NOT EXISTS cms_snap CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("GRANT ALL PRIVILEGES ON cms_snap.* TO 'cms'@'127.0.0.1'");
  await root.query("GRANT ALL PRIVILEGES ON typecho_restore.* TO 'cms'@'127.0.0.1'");
  await root.end();

  const cms = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'cms',
    password: 'cms-dev',
    database: 'cms_snap',
    charset: 'utf8mb4',
  });
  const typecho = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'cms',
    password: 'cms-dev',
    database: 'typecho_restore',
    charset: 'utf8mb4',
  });
  try {
    await ensureCmsSchema(cms);
    await cms.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'cms_publish_outbox', 'cms_change_log', 'cms_import_runs', 'cms_content_revisions',
      'cms_contents', 'cms_metas', 'cms_relationships', 'cms_fields',
      'cms_i18n_source_state', 'cms_i18n_translation_head', 'cms_i18n_translation_version',
      'cms_i18n_translation_job', 'cms_i18n_publish_outbox', 'cms_i18n_publication_ledger',
      'cms_i18n_migrations',
    ]) {
      await cms.query(`DELETE FROM ${table}`);
    }
    await cms.query('SET FOREIGN_KEY_CHECKS = 1');
    await applyBootstrap(cms, loadPackage(), {
      packageId: 'fixture-positive',
      source: 'synthetic-sanitized-fixture',
    });

    const created = await saveContent(cms, {
      cid: 11,
      title: '新文章',
      slug: 'new-post',
      text: '<!--markdown-->新文章正文\n',
      baseRevision: 0,
    });
    assert.equal(created.ok, true);
    const edited = await saveContent(cms, {
      cid: 8,
      title: 'HTML 存量',
      text: '<p>改过的 HTML</p>',
      baseRevision: 1,
      fields: [{ name: 'legacy_note', type: 'str', str_value: '改过的字段', int_value: null, float_value: null }],
      relationshipMids: [1],
    });
    assert.equal(edited.ok, true);
    const stale = await saveContent(cms, {
      cid: 8,
      text: '<p>过期</p>',
      baseRevision: 1,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 409);
    assert.equal((await getContent(cms, 8)).text, '<p>改过的 HTML</p>');
    const moment = await saveContent(cms, {
      cid: 7,
      text: '<!--markdown-->闲话示例\n',
      baseRevision: 1,
    });
    assert.equal(moment.ok, true);
    const [momentJobs] = await cms.query('SELECT job_id FROM cms_i18n_translation_job WHERE cid = 7');
    assert.equal(momentJobs.length, 0);
    const removed = await deleteContent(cms, { cid: 1, baseRevision: 1 });
    assert.equal(removed.ok, true);
    const [deleteEvents] = await cms.query(
      `SELECT op FROM cms_publish_outbox WHERE cid = 1 AND op = 'delete'`,
    );
    assert.equal(deleteEvents.length, 1);
    const disabled = await setTranslationPublication(cms, { cid: 2, locale: 'en', state: 'disabled' });
    assert.equal(disabled.ok, true);
    const [jobs] = await cms.query(
      `SELECT status FROM cms_i18n_translation_job WHERE cid = 2`,
    );
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((row) => row.status === 'cancelled'));

    const exported = await exportPackageTables(cms);
    await applyRestore(typecho, exported);
    const [gone] = await typecho.query('SELECT cid FROM typecho_contents WHERE cid = 1');
    assert.equal(gone.length, 0);
    const [html] = await typecho.query('SELECT text FROM typecho_contents WHERE cid = 8');
    assert.equal(html[0].text, '<p>改过的 HTML</p>');
    const [field] = await typecho.query(
      `SELECT str_value FROM typecho_fields WHERE cid = 8 AND name = 'legacy_note'`,
    );
    assert.equal(field[0].str_value, '改过的字段');
    const [rel] = await typecho.query('SELECT mid FROM typecho_relationships WHERE cid = 8');
    assert.deepEqual(rel.map((row) => Number(row.mid)), [1]);
    const [head] = await typecho.query(
      `SELECT publication_state FROM typecho_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(head[0].publication_state, 'disabled');
    await typecho.query(
      `INSERT INTO typecho_contents
         (cid, title, slug, created, modified, text, type, status)
       VALUES (1, '复活', 'back', 1, 1, 'no', 'page', 'publish')`,
    );
    await applyRestore(typecho, exported);
    const [stillGone] = await typecho.query('SELECT cid FROM typecho_contents WHERE cid = 1');
    assert.equal(stillGone.length, 0);

    const cmsSnapshot = await readBuildSnapshot(cms, { source: 'cms', epoch: EPOCH });
    const typechoSnapshot = await readBuildSnapshot(typecho, { source: 'typecho', epoch: EPOCH });
    const report = compareSnapshotData(cmsSnapshot, typechoSnapshot);
    assert.deepEqual(report.differences, []);
    assert.equal(cmsSnapshot.contents.some((row) => Number(row.cid) === 1), false);
    assert.equal(
      cmsSnapshot.contents.find((row) => Number(row.cid) === 11).text,
      '<!--markdown-->新文章正文\n',
    );
  } finally {
    await cms.end();
    await typecho.end();
  }
});
