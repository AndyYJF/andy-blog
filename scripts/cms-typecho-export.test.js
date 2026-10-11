import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyRestore, ensureTypechoSchema } from '../cms/src/lib/restore-typecho.js';

const root = path.resolve(import.meta.dirname, '..');
const fixtureDir = path.resolve(root, 'docs/cms/fixtures/migration/positive/tables');
const uploadRoot = path.resolve(root, 'docs/cms/fixtures/migration/positive/uploads/files');

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

test('typecho export normalizes leases in the package and leaves the source leased', async (t) => {
  const refused = spawnSync(process.execPath, [path.join(root, 'scripts', 'export-typecho-migration.js'), '--package', path.join(os.tmpdir(), 'cms-typecho-refused')], {
    cwd: root,
    env: { ...process.env, DB_HOST: '127.0.0.1', DB_NAME: 'cms_shadow', DB_PASSWORD: '' },
    encoding: 'utf8',
  });
  assert.equal(refused.status, 65, refused.stderr);

  const mysql = await import('mysql2/promise');
  let rootDb;
  try {
    rootDb = await mysql.createConnection({
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
  await rootDb.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await rootDb.end();
  const admin = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: '',
    database: 'typecho_restore',
  });
  const out = path.join(os.tmpdir(), `typecho-migration-${process.pid}`);
  try {
    await ensureTypechoSchema(admin);
    await applyRestore(admin, loadPackage());
    const exported = spawnSync(process.execPath, [path.join(root, 'scripts', 'export-typecho-migration.js'), '--package', out], {
      cwd: root,
      env: {
        ...process.env,
        DB_HOST: '127.0.0.1',
        DB_PORT: '3307',
        DB_USER: 'root',
        DB_PASSWORD: '',
        DB_NAME: 'typecho_restore',
        CMS_UPLOAD_ROOT: uploadRoot,
      },
      encoding: 'utf8',
    });
    assert.equal(exported.status, 0, exported.stderr);
    const report = JSON.parse(exported.stdout);
    assert.equal(report.leasedNormalized, 1);
    assert.equal(report.controlledRebuild, 0);
    const [live] = await admin.query(
      `SELECT status, lease_owner, expected_source_hash FROM typecho_i18n_translation_job WHERE job_id = 2`,
    );
    assert.equal(live[0].status, 'leased');
    assert.equal(live[0].lease_owner, 'worker-a');
    const packaged = JSON.parse(fs.readFileSync(path.join(out, 'tables', 'i18n_translation_job.json'), 'utf8'));
    const job = packaged.find((row) => row.job_id === 2);
    assert.equal(job.status, 'queued');
    assert.equal(job.lease_owner, null);
    assert.equal(job.expected_source_hash, live[0].expected_source_hash);
    const [text] = await admin.query(`SELECT text FROM typecho_contents WHERE cid = 2`);
    assert.equal(text[0].text, '<!--markdown-->正文示例\n');
  } finally {
    await admin.end();
    fs.rmSync(out, { recursive: true, force: true });
  }
});
