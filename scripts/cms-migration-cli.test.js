import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureTypechoSchema } from '../cms/src/lib/restore-typecho.js';
import { normalizeLeasedJobs, rebuildPlan } from './lib/cms-migration-cli.js';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(root, 'docs/cms/fixtures/migration/positive');
const uploadRoot = path.join(fixture, 'uploads', 'files');

function run(script, args, env) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('leased jobs are normalized without recomputing the source hash', () => {
  const jobs = [{
    status: 'leased',
    lease_owner: 'worker-a',
    lease_until: 1700000800,
    expected_source_hash: 'abc',
    expected_source_revision: 3,
  }];
  const next = normalizeLeasedJobs(jobs);
  assert.equal(next[0].status, 'queued');
  assert.equal(next[0].lease_owner, null);
  assert.equal(next[0].lease_until, null);
  assert.equal(next[0].expected_source_hash, 'abc');
  assert.equal(next[0].expected_source_revision, 3);
  assert.equal(jobs[0].status, 'leased');
  assert.deepEqual(
    rebuildPlan([{ status: 'pending' }, { status: 'sending' }, { status: 'accepted' }]),
    { controlledRebuild: 1, retainedPublishEvents: 2 },
  );
});

test('import and restore default to dry-run and refuse a non-local host', () => {
  const imported = run('import-typecho-to-cms.js', ['--package', fixture, '--mode', 'bootstrap'], {
    DB_HOST: '10.1.2.3',
    DB_NAME: 'cms_cli',
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).dryRun, true);
  assert.equal(JSON.parse(imported.stdout).counts.contents, 10);

  const missing = run('import-typecho-to-cms.js', ['--package', fixture], {});
  assert.equal(missing.status, 64);

  const remote = run('import-typecho-to-cms.js', ['--package', fixture, '--mode', 'bootstrap', '--execute'], {
    DB_HOST: '10.1.2.3',
    DB_NAME: 'cms_cli',
  });
  assert.equal(remote.status, 65, remote.stderr);

  const exported = run('export-cms-migration.js', ['--package', path.join(os.tmpdir(), 'cms-export-refused')], {
    DB_HOST: '10.1.2.3',
    DB_NAME: 'cms_cli',
  });
  assert.equal(exported.status, 65, exported.stderr);
});

test('export normalizes leases and restore keeps unfinished publish events', async (t) => {
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
  await rootDb.query('DROP DATABASE IF EXISTS cms_cli');
  await rootDb.query('CREATE DATABASE cms_cli CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await rootDb.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await rootDb.end();

  const imported = run('import-typecho-to-cms.js', ['--package', fixture, '--mode', 'bootstrap', '--execute'], {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'cms_cli',
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).dryRun, false);

  const cms = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_cli',
  });
  await cms.query(
    `INSERT INTO cms_publish_outbox
      (idem_key, change_seq, cid, op, status, attempts, max_attempts, next_retry_at, created_at, updated_at)
     VALUES ('cli-test', 1, 2, 'update', 'pending', 0, 8, 1, 1, 1)`,
  );
  const [before] = await cms.query(
    `SELECT status, lease_owner, expected_source_hash FROM cms_i18n_translation_job WHERE job_id = 2`,
  );
  assert.equal(before[0].status, 'leased');

  const out = path.join(os.tmpdir(), `cms-migration-${process.pid}`);
  fs.rmSync(out, { recursive: true, force: true });
  const exported = run('export-cms-migration.js', ['--package', out], {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'cms_cli',
    CMS_UPLOAD_ROOT: uploadRoot,
  });
  assert.equal(exported.status, 0, exported.stderr);
  const exportReport = JSON.parse(exported.stdout);
  assert.equal(exportReport.leasedNormalized, 1);
  assert.equal(exportReport.controlledRebuild, 1);
  assert.equal(exportReport.retainedPublishEvents, 1);
  assert.equal(exportReport.owedRebuild.requests, 1);
  assert.equal(exportReport.owedRebuild.evidence, null);
  assert.equal(exportReport.owedRebuild.eventIds.length, 1);

  const [after] = await cms.query(
    `SELECT status, lease_owner, expected_source_hash FROM cms_i18n_translation_job WHERE job_id = 2`,
  );
  assert.equal(after[0].status, 'leased');
  assert.equal(after[0].lease_owner, 'worker-a');
  const packaged = JSON.parse(fs.readFileSync(path.join(out, 'tables', 'i18n_translation_job.json'), 'utf8'));
  const packagedJob = packaged.find((row) => row.job_id === 2);
  assert.equal(packagedJob.status, 'queued');
  assert.equal(packagedJob.lease_owner, null);
  assert.equal(packagedJob.lease_until, null);
  assert.equal(packagedJob.expected_source_hash, after[0].expected_source_hash);
  assert.equal(packagedJob.expected_source_revision, 3);
  const retained = JSON.parse(fs.readFileSync(path.join(out, 'cms-only', 'publish-outbox.json'), 'utf8'));
  assert.equal(retained.some((row) => row.idem_key === 'cli-test' && row.status === 'pending'), true);

  const typecho = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'typecho_restore',
  });
  await ensureTypechoSchema(typecho);
  await typecho.query('DELETE FROM typecho_contents WHERE cid = 990001');
  await typecho.query(
    `INSERT INTO typecho_contents (cid, title, slug, created, modified, text, type, status)
     VALUES (990001, 'extra', 'extra', 1, 1, 'extra', 'post', 'publish')`,
  );

  const preview = run('restore-cms-to-typecho.js', ['--package', out], {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'typecho_restore',
  });
  assert.equal(preview.status, 0, preview.stderr);
  const previewReport = JSON.parse(preview.stdout);
  assert.equal(previewReport.dryRun, true);
  assert.equal(previewReport.controlledRebuild, 1);
  assert.equal(previewReport.retainedPublishEvents, 1);
  assert.equal(previewReport.owedRebuild.requests, 1);
  assert.deepEqual(previewReport.owedRebuild.eventIds, exportReport.owedRebuild.eventIds);
  assert.equal(previewReport.delete.contents.includes('990001'), true);
  const [still] = await typecho.query('SELECT cid FROM typecho_contents WHERE cid = 990001');
  assert.equal(still.length, 1);

  const wrong = run('restore-cms-to-typecho.js', ['--package', out, '--execute'], {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'cms_cli',
  });
  assert.equal(wrong.status, 65, wrong.stderr);
  const [untouched] = await cms.query('SELECT COUNT(*) AS n FROM cms_contents');
  assert.equal(Number(untouched[0].n), 10);
  const [stillAfterRefuse] = await typecho.query('SELECT cid FROM typecho_contents WHERE cid = 990001');
  assert.equal(stillAfterRefuse.length, 1);

  const applied = run('restore-cms-to-typecho.js', ['--package', out, '--execute'], {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'typecho_restore',
  });
  assert.equal(applied.status, 0, applied.stderr);
  const appliedReport = JSON.parse(applied.stdout);
  assert.equal(appliedReport.dryRun, false);
  assert.equal(appliedReport.applied, true);
  const counters = [
    ['typecho_contents', 'cid', 'cid'],
    ['typecho_metas', 'mid', 'mid'],
    ['typecho_i18n_translation_version', 'version_id', 'version_id'],
    ['typecho_i18n_translation_job', 'job_id', 'job_id'],
    ['typecho_i18n_publish_outbox', 'event_id', 'event_id'],
  ];
  for (const [table, column, key] of counters) {
    const [maxRow] = await typecho.query(`SELECT COALESCE(MAX(${column}), 0) AS n FROM ${table}`);
    const [increment] = await typecho.query(
      `SELECT AUTO_INCREMENT AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    );
    assert.equal(appliedReport.autoIncrement[key], Number(maxRow[0].n) + 1);
    assert.equal(Number(increment[0].n), appliedReport.autoIncrement[key]);
  }
  const [gone] = await typecho.query('SELECT cid FROM typecho_contents WHERE cid = 990001');
  assert.equal(gone.length, 0);
  const [restoredJob] = await typecho.query(
    `SELECT status, lease_owner, expected_source_hash FROM typecho_i18n_translation_job WHERE job_id = 2`,
  );
  assert.equal(restoredJob[0].status, 'queued');
  assert.equal(restoredJob[0].lease_owner, null);
  assert.equal(restoredJob[0].expected_source_hash, after[0].expected_source_hash);
  const [generic] = await typecho.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = 'typecho_restore' AND table_name = 'typecho_publish_outbox'`,
  );
  assert.equal(Number(generic[0].n), 0);
  const retainedAfter = JSON.parse(fs.readFileSync(path.join(out, 'cms-only', 'publish-outbox.json'), 'utf8'));
  assert.equal(retainedAfter.some((row) => row.idem_key === 'cli-test'), true);
  const [stillLeased] = await cms.query('SELECT status FROM cms_i18n_translation_job WHERE job_id = 2');
  assert.equal(stillLeased[0].status, 'leased');

  await cms.end();
  await typecho.end();
  fs.rmSync(out, { recursive: true, force: true });
});
