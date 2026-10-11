import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBootstrap } from '../cms/src/lib/import-apply.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import { applyRestore } from '../cms/src/lib/restore-typecho.js';
import { compareSnapshotData } from './lib/cms-contract.js';

const root = path.resolve(import.meta.dirname, '..');
const fixtureDir = path.resolve(root, 'docs/cms/fixtures/migration/positive/tables');
const script = path.join(root, 'scripts', 'export-content-snapshot.js');

function run(file, env) {
  return spawnSync(process.execPath, [file], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

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

test('content snapshot export refuses a CMS group that points elsewhere', () => {
  assert.equal(fs.readFileSync(script).includes(13), false);
  const missing = run(script, { EXPORT_SNAPSHOT_JSON: path.join(os.tmpdir(), 'snapshot.json') });
  assert.equal(missing.status, 64);
  const relative = run(script, { SNAPSHOT_EPOCH: '1700000400', EXPORT_SNAPSHOT_JSON: 'snapshot.json' });
  assert.equal(relative.status, 64);

  const remote = run(script, {
    CONTENT_SOURCE: 'cms',
    DB_PREFIX: 'cms_',
    I18N_OBSERVE_PREFIX: 'cms_',
    CMS_DB_HOST: '127.0.0.1',
    CMS_RO_DB_USER: 'cms',
    CMS_RO_DB_PASSWORD: 'cms-dev',
    CMS_DB_NAME: 'cms_snap_src',
    DB_HOST: '10.1.2.3',
    DB_NAME: 'cms_snap_src',
    SNAPSHOT_EPOCH: '1700000400',
    EXPORT_SNAPSHOT_JSON: path.join(os.tmpdir(), 'cms-snapshot-refused.json'),
  });
  assert.equal(remote.status, 65, remote.stderr);
  assert.match(remote.stderr, /refuses a different DB_HOST/);

  const forced = run(path.join(root, 'scripts', 'export-cms-snapshot.js'), {
    CONTENT_SOURCE: 'typecho',
    DB_PREFIX: 'cms_',
    I18N_OBSERVE_PREFIX: 'cms_',
    SNAPSHOT_EPOCH: '1700000400',
    EXPORT_SNAPSHOT_JSON: path.join(os.tmpdir(), 'cms-snapshot-forced.json'),
    CMS_DB_HOST: '127.0.0.1',
    CMS_DB_NAME: 'cms_snap_src',
    CMS_RO_DB_USER: 'cms',
    CMS_RO_DB_PASSWORD: '',
  });
  assert.equal(forced.status, 65, forced.stderr);
  assert.match(forced.stderr, /CMS_RO_DB_PASSWORD is required/);
});

test('the same frozen package exports equal Typecho and CMS snapshots', async (t) => {
  const mysql = await import('mysql2/promise');
  let admin;
  try {
    admin = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await admin.query('DROP DATABASE IF EXISTS cms_snap_src');
  await admin.query('CREATE DATABASE cms_snap_src CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await admin.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await admin.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await admin.query("GRANT ALL PRIVILEGES ON cms_snap_src.* TO 'cms'@'127.0.0.1'");
  await admin.query("GRANT ALL PRIVILEGES ON typecho_restore.* TO 'cms'@'127.0.0.1'");
  await admin.query('FLUSH PRIVILEGES');
  await admin.end();

  const cms = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_snap_src',
  });
  const typecho = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'typecho_restore',
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-content-snapshot-'));
  const cmsOut = path.join(dir, 'cms.json');
  const typechoOut = path.join(dir, 'typecho.json');
  try {
    await ensureCmsSchema(cms);
    await applyBootstrap(cms, loadPackage(), { packageId: 'fixture-positive', source: 'snapshot-export' });
    await applyRestore(typecho, loadPackage());

    const typechoExport = run(script, {
      CONTENT_SOURCE: 'typecho',
      DB_PREFIX: 'typecho_',
      I18N_OBSERVE_PREFIX: 'typecho_',
      CMS_DB_HOST: '',
      CMS_DB_NAME: '',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_USER: 'cms',
      DB_PASSWORD: 'cms-dev',
      DB_NAME: 'typecho_restore',
      SNAPSHOT_EPOCH: '1700000400',
      EXPORT_SNAPSHOT_JSON: typechoOut,
    });
    assert.equal(typechoExport.status, 0, typechoExport.stderr);
    assert.equal(JSON.parse(typechoExport.stdout).source, 'typecho');

    const cmsExport = run(script, {
      CONTENT_SOURCE: 'cms',
      DB_PREFIX: 'cms_',
      I18N_OBSERVE_PREFIX: 'cms_',
      CMS_DB_HOST: '127.0.0.1',
      CMS_DB_PORT: '3307',
      CMS_RO_DB_USER: 'cms',
      CMS_RO_DB_PASSWORD: 'cms-dev',
      CMS_DB_NAME: 'cms_snap_src',
      TYPECHO_DB_NAME: 'typecho_restore',
      DB_HOST: '127.0.0.1',
      DB_NAME: 'cms_snap_src',
      SNAPSHOT_EPOCH: '1700000400',
      EXPORT_SNAPSHOT_JSON: cmsOut,
    });
    assert.equal(cmsExport.status, 0, cmsExport.stderr);
    assert.equal(JSON.parse(cmsExport.stdout).source, 'cms');

    const cmsSnapshot = JSON.parse(fs.readFileSync(cmsOut, 'utf8'));
    const typechoSnapshot = JSON.parse(fs.readFileSync(typechoOut, 'utf8'));
    const report = compareSnapshotData(cmsSnapshot, typechoSnapshot);
    assert.deepEqual(report.differences, []);
    assert.equal(cmsSnapshot.i18n.versions.some((row) => Number(row.version_id) === 11), false);
    assert.equal(typechoSnapshot.i18n.versions.some((row) => Number(row.version_id) === 11), false);
  } finally {
    await cms.end();
    await typecho.end();
  }
});
