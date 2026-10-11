import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { contentTablePrefix, readBuildSnapshot, resolveContentSource } from './lib/content-source.js';
import { assertContentSourceGroup, assertWorkerSource } from './lib/content-source-launch.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function sourceEnv(extra = {}) {
  const env = { ...extra };
  return env;
}

test('content source defaults to Typecho and does not accept another name', () => {
  assert.equal(resolveContentSource({}), 'typecho');
  assert.equal(resolveContentSource({ CONTENT_SOURCE: '' }), 'typecho');
  assert.equal(resolveContentSource({ CONTENT_SOURCE: 'cms' }), 'cms');
  assert.equal(contentTablePrefix('typecho'), 'typecho_');
  assert.equal(contentTablePrefix('cms'), 'cms_');
  assert.throws(() => resolveContentSource({ CONTENT_SOURCE: 'both' }), /unknown CONTENT_SOURCE/);
});

test('a failed CMS export does not query Typecho tables', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (sql.includes('cms_contents')) throw new Error('cms down');
      return [[]];
    },
  };
  await assert.rejects(
    () => readBuildSnapshot(db, { source: 'cms', epoch: 1700000000 }),
    /cms down/,
  );
  assert.equal(seen.some((sql) => sql.includes('typecho_')), false);
});

test('the default export still names Typecho tables and can omit i18n', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (sql.includes('i18n_')) {
        const error = new Error('missing');
        error.code = 'ER_NO_SUCH_TABLE';
        throw error;
      }
      return [[]];
    },
  };
  const snapshot = await readBuildSnapshot(db, { source: 'typecho', epoch: 1700000000 });
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(Object.hasOwn(snapshot, 'i18n'), false);
  assert.equal(seen[0].includes('FROM typecho_contents'), true);
  assert.equal(seen.some((sql) => sql.includes('cms_')), false);
});

test('CMS export reads the isolated cms_ tables and leaves drafts out', async (t) => {
  const mysql = await import('mysql2/promise');
  let db;
  try {
    db = await mysql.createConnection({
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
  try {
    const snapshot = await readBuildSnapshot(db, { source: 'cms', epoch: 1700000000 });
    assert.equal(snapshot.contents.some((row) => Number(row.cid) === 9), false);
    assert.match(snapshot.contents.find((row) => Number(row.cid) === 2).text, /正文示例/);
    assert.equal(snapshot.i18n.versions.some((row) => Number(row.version_id) === 11), false);
    assert.equal(snapshot.i18n.versions.some((row) => Number(row.version_id) === 10), true);
  } finally {
    await db.end();
  }
});

const cmsGroup = {
  CONTENT_SOURCE: 'cms',
  DB_PREFIX: 'cms_',
  I18N_OBSERVE_PREFIX: 'cms_',
  CMS_DB_HOST: '127.0.0.1',
  CMS_RO_DB_USER: 'cms',
  CMS_RO_DB_PASSWORD: 'cms-dev',
  CMS_DB_NAME: 'cms',
  TYPECHO_DB_NAME: 'typecho_db',
};

test('the source group stays on Typecho unless CMS is named completely', () => {
  assert.deepEqual(assertContentSourceGroup(sourceEnv()), {
    source: 'typecho',
    observePrefix: 'typecho_',
    useCmsDb: false,
  });
  assert.equal(assertWorkerSource(sourceEnv()).prefix, 'typecho_');
  assert.throws(() => assertWorkerSource(sourceEnv({ DB_PREFIX: 'cms_' })), /refuses DB_PREFIX/);
  assert.throws(() => assertContentSourceGroup(sourceEnv({ CMS_DB_HOST: '127.0.0.1' })), /refuses CMS_DB_HOST/);
  const partial = { ...cmsGroup };
  delete partial.CMS_RO_DB_PASSWORD;
  assert.throws(() => assertContentSourceGroup(sourceEnv(partial)), /CMS_RO_DB_PASSWORD is required/);
  const sameDb = { ...cmsGroup, CMS_DB_NAME: 'typecho_db' };
  assert.throws(() => assertContentSourceGroup(sourceEnv(sameDb)), /different database/);
  const mismatched = { ...cmsGroup, I18N_OBSERVE_PREFIX: 'typecho_' };
  assert.throws(() => assertContentSourceGroup(sourceEnv(mismatched)), /does not match/);
  assert.deepEqual(assertContentSourceGroup(sourceEnv(cmsGroup)), {
    source: 'cms',
    observePrefix: 'cms_',
    useCmsDb: true,
  });
});

test('a half-configured CMS plan exits before printing a database choice', () => {
  assert.throws(() => execFileSync(process.execPath, ['scripts/print-content-source-plan.js'], {
    cwd: ROOT,
    env: sourceEnv({ CONTENT_SOURCE: 'cms', DB_PREFIX: 'cms_', I18N_OBSERVE_PREFIX: 'cms_' }),
    encoding: 'utf8',
    timeout: 15000,
  }), (error) => error.status === 65 && /CMS_DB_HOST is required/.test(String(error.stderr)));
});

test('CMS sync does not open the Typecho database', () => {
  let stderr = '';
  try {
    execFileSync(process.execPath, ['scripts/sync-typecho.js'], {
      cwd: ROOT,
      env: sourceEnv({
        CONTENT_SOURCE: 'cms',
        DB_HOST: '127.0.0.1',
        DB_USER: 'typecho',
        DB_PASSWORD: 'secret',
        DB_NAME: 'typecho_db',
        SNAPSHOT_EPOCH: '1700000000',
      }),
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.fail('sync should have refused the live database');
  } catch (error) {
    stderr = `${error.stderr || ''}${error.stdout || ''}${error.message || ''}`;
  }
  assert.match(stderr, /cms sync refuses a live database read/);
});

test('rebuild and backup mount the exporter modules and keep CMS off the Typecho build', () => {
  const rebuild = fs.readFileSync(path.join(ROOT, 'host/blog-rebuild-1panel.sh'), 'utf8');
  const backup = fs.readFileSync(path.join(ROOT, 'host/backup-content-github.sh'), 'utf8');
  const helper = fs.readFileSync(path.join(ROOT, 'host/content-source-env.sh'), 'utf8');
  for (const text of [rebuild, backup]) {
    assert.match(text, /content_source_resolve/);
    assert.match(text, /content_source_export_mounts/);
    assert.match(text, /content_source_fill_docker_env/);
  }
  assert.match(helper, /content-source\.js:\/app\/scripts\/lib\/content-source\.js:ro/);
  assert.match(helper, /content-source-launch\.js:\/app\/scripts\/lib\/content-source-launch\.js:ro/);
  assert.match(helper, /i18n-snapshot\.js:\/app\/scripts\/lib\/i18n-snapshot\.js:ro/);
  assert.match(helper, /export-content-snapshot\.js/);
  const cmsStart = rebuild.indexOf('build_via_vps_overlay');
  const cmsBranch = rebuild.slice(cmsStart, rebuild.indexOf('return 0', cmsStart));
  assert.match(cmsBranch, /content_source_blank_db_env/);
  assert.match(cmsBranch, /content_source_snapshot_script/);
  assert.doesNotMatch(cmsBranch, /export-typecho-snapshot\.js/);
  const typechoOverlay = rebuild.slice(rebuild.indexOf('return 0', cmsStart), rebuild.indexOf('build_via_offbox'));
  assert.equal(typechoOverlay.includes('CONTENT_SOURCE=cms'), false);
  assert.equal(typechoOverlay.includes('content_source_blank_db_env'), false);
  assert.match(rebuild, /--prefix "\$CONTENT_SOURCE_OBSERVE_PREFIX"/);
  assert.equal(rebuild.includes('DB_PASSWORD='), false);
  assert.match(helper, /content_source_blank_db_env/);
  assert.match(backup, /content_source_blank_db_env/);
});
