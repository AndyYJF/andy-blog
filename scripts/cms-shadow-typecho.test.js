import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { applyRestore, ensureTypechoSchema } from '../cms/src/lib/restore-typecho.js';

const rootDir = path.resolve(import.meta.dirname, '..');
const fixtureDir = path.resolve(rootDir, 'docs/cms/fixtures/migration/positive/tables');
const uploadRoot = path.resolve(rootDir, 'docs/cms/fixtures/migration/positive/uploads/files');
const script = path.join(rootDir, 'scripts', 'cms-shadow-sync.js');

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

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: rootDir,
    env: { ...process.env, DB_PASSWORD: '', CMS_DB_PASSWORD: '', ...env },
    encoding: 'utf8',
  });
}

test('shadow sync dry-run reads typecho and execute mirrors without editing it', async (t) => {
  const packageDir = path.join(os.tmpdir(), `cms-shadow-ty-${process.pid}`);
  const wrong = run(['--package', packageDir, '--execute'], {
    DB_HOST: '127.0.0.1',
    DB_NAME: 'typecho_restore',
    CMS_DB_HOST: '10.1.2.3',
    CMS_DB_NAME: 'cms_shadow_ty',
  });
  assert.equal(wrong.status, 65, wrong.stderr);

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
  await root.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query('DROP DATABASE IF EXISTS cms_shadow_ty');
  await root.query('CREATE DATABASE cms_shadow_ty CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const typecho = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'typecho_restore',
  });
  const shadow = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_shadow_ty',
  });
  const env = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_NAME: 'typecho_restore',
    CMS_UPLOAD_ROOT: uploadRoot,
    CMS_DB_HOST: '127.0.0.1',
    CMS_DB_PORT: '3307',
    CMS_DB_USER: 'root',
    CMS_DB_NAME: 'cms_shadow_ty',
  };
  try {
    await ensureTypechoSchema(typecho);
    await applyRestore(typecho, loadPackage());
    const preview = run(['--package', packageDir], env);
    assert.equal(preview.status, 0, preview.stderr);
    const previewReport = JSON.parse(preview.stdout);
    assert.equal(previewReport.dryRun, true);
    assert.equal(previewReport.counts.contents, 10);
    const [untouched] = await shadow.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = 'cms_shadow_ty' AND table_name = 'cms_contents'`,
    );
    assert.equal(Number(untouched[0].n), 0);

    const applied = run(['--package', packageDir, '--execute'], env);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).dryRun, false);
    assert.equal(JSON.parse(applied.stdout).counts.contents, 10);
    const [copied] = await shadow.query(`SELECT text FROM cms_contents WHERE cid = 2`);
    assert.equal(copied[0].text, '<!--markdown-->正文示例\n');
    const [mode] = await shadow.query(`SELECT mode FROM cms_runtime WHERE id = 1`);
    assert.equal(mode[0].mode, 'shadow');
    const refused = await saveContent(shadow, {
      cid: 2, baseRevision: 1, title: '不能改', slug: 'sample-post', text: '改了',
    });
    assert.equal(refused.status, 403);
    const [live] = await typecho.query(
      `SELECT status, lease_owner FROM typecho_i18n_translation_job WHERE job_id = 2`,
    );
    assert.equal(live[0].status, 'leased');
    assert.equal(live[0].lease_owner, 'worker-a');

    for (const table of [
      'typecho_relationships', 'typecho_fields', 'typecho_i18n_source_state',
      'typecho_i18n_translation_head', 'typecho_i18n_translation_version',
      'typecho_i18n_translation_job', 'typecho_i18n_publish_outbox',
      'typecho_i18n_publication_ledger', 'typecho_contents',
    ]) {
      await typecho.query(`DELETE FROM ${table} WHERE cid = 9`);
    }
    const again = run(['--package', packageDir, '--execute'], env);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).counts.contents, 9);
    const [gone] = await shadow.query('SELECT cid FROM cms_contents WHERE cid = 9');
    assert.equal(gone.length, 0);
    const [still] = await typecho.query(
      `SELECT status FROM typecho_i18n_translation_job WHERE job_id = 2`,
    );
    assert.equal(still[0].status, 'leased');
    const [events] = await shadow.query('SELECT COUNT(*) AS n FROM cms_publish_outbox');
    assert.equal(Number(events[0].n), 0);
  } finally {
    await typecho.end();
    await shadow.end();
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});
