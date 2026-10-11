import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBootstrap } from '../cms/src/lib/import-apply.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import { applyRestore } from '../cms/src/lib/restore-typecho.js';
import { compareDistDirs, compareSnapshotData } from './lib/cms-contract.js';
import { deriveDescription } from './lib/content-presentation.js';

const BUILD_PAD = '这是脱敏样本为了通过站点摘要长度而补上的说明文字。';

const root = path.resolve(import.meta.dirname, '..');
const fixtureDir = path.resolve(root, 'docs/cms/fixtures/migration/positive/tables');

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

function unixPath(file) {
  const result = spawnSync('bash', ['-lc', 'cygpath -u "$1"', 'bash', path.resolve(file)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function exportSnapshot(env) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'export-content-snapshot.js')], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function padSnapshotForBuild(snapshot) {
  for (const row of snapshot.contents || []) {
    const body = String(row.text || '').replace(/^<!--markdown-->\s*/i, '');
    if (deriveDescription(body).length >= 24) continue;
    const marker = /^<!--markdown-->/i.test(String(row.text || '')) ? '<!--markdown-->' : '';
    row.text = `${marker}${body.replace(/\s*$/u, '')}\n\n${BUILD_PAD}\n`;
  }
  for (const version of snapshot.i18n?.versions || []) {
    const summary = String(version.summary || '').trim();
    const description = summary.length >= 24 ? summary : deriveDescription(String(version.body || ''));
    if (description.length >= 24 && description.length <= 470) continue;
    version.summary = 'This sample summary is long enough for the visitor build.';
  }
}

function shadowBuild(work, fixture, routeMap, metaMap) {
  return spawnSync('bash', ['-lc', 'exec bash scripts/cms-shadow-build.sh'], {
    cwd: root,
    env: {
      ...process.env,
      SHADOW_BUILD_DIST: '1',
      SHADOW_WORK: unixPath(work),
      SNAPSHOT_EPOCH: '1700000400',
      FIXTURE_PATH: unixPath(fixture),
      SHADOW_ROUTE_MAP: unixPath(routeMap),
      SHADOW_META_ROUTE_MAP: unixPath(metaMap),
    },
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

test('the same frozen package builds matching Typecho and CMS dists', { timeout: 900000 }, async (t) => {
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
  await admin.query('DROP DATABASE IF EXISTS cms_distpair');
  await admin.query('CREATE DATABASE cms_distpair CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await admin.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await admin.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await admin.query("GRANT ALL PRIVILEGES ON cms_distpair.* TO 'cms'@'127.0.0.1'");
  await admin.query("GRANT ALL PRIVILEGES ON typecho_restore.* TO 'cms'@'127.0.0.1'");
  await admin.query('FLUSH PRIVILEGES');
  await admin.end();

  const cms = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_distpair',
  });
  const typecho = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'typecho_restore',
  });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-dist-pair-'));
  const routeMap = path.join(work, 'route-map.json');
  const metaMap = path.join(work, 'meta-route-map.json');
  fs.writeFileSync(routeMap, `${JSON.stringify({
    1: {
      kind: 'page',
      routeId: 'about-sample',
      canonicalPath: '/about-sample/',
      sourceSlug: 'about-sample',
      feedGuid: 'urn:andy-y:page:about-sample',
      commentKey: '/about-sample/',
      legacyPaths: [],
      state: 'active',
    },
  })}\n`);
  fs.writeFileSync(metaMap, '{}\n');
  const repoRoute = path.join(root, 'data', 'route-map.json');
  const repoMeta = path.join(root, 'data', 'meta-route-map.json');
  const routeBefore = crypto.createHash('sha256').update(fs.readFileSync(repoRoute)).digest('hex');
  const metaBefore = crypto.createHash('sha256').update(fs.readFileSync(repoMeta)).digest('hex');
  try {
    await ensureCmsSchema(cms);
    await applyBootstrap(cms, loadPackage(), { packageId: 'fixture-positive', source: 'dist-pair' });
    await applyRestore(typecho, loadPackage());
    const typechoJson = path.join(work, 'typecho.json');
    const cmsJson = path.join(work, 'cms.json');
    const typechoExport = exportSnapshot({
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
      EXPORT_SNAPSHOT_JSON: typechoJson,
    });
    assert.equal(typechoExport.status, 0, typechoExport.stderr);
    const cmsExport = exportSnapshot({
      CONTENT_SOURCE: 'cms',
      DB_PREFIX: 'cms_',
      I18N_OBSERVE_PREFIX: 'cms_',
      CMS_DB_HOST: '127.0.0.1',
      CMS_DB_PORT: '3307',
      CMS_RO_DB_USER: 'cms',
      CMS_RO_DB_PASSWORD: 'cms-dev',
      CMS_DB_NAME: 'cms_distpair',
      TYPECHO_DB_NAME: 'typecho_restore',
      DB_HOST: '127.0.0.1',
      DB_NAME: 'cms_distpair',
      SNAPSHOT_EPOCH: '1700000400',
      EXPORT_SNAPSHOT_JSON: cmsJson,
    });
    assert.equal(cmsExport.status, 0, cmsExport.stderr);
    const typechoSnapshot = JSON.parse(fs.readFileSync(typechoJson, 'utf8'));
    const cmsSnapshot = JSON.parse(fs.readFileSync(cmsJson, 'utf8'));
    assert.deepEqual(compareSnapshotData(cmsSnapshot, typechoSnapshot).differences, []);
    for (const snapshot of [typechoSnapshot, cmsSnapshot]) {
      for (const field of snapshot.fields) {
        if (Number(field.cid) === 7 && field.name === 'moment_topics') field.str_value = '["示例"]';
      }
      padSnapshotForBuild(snapshot);
      fs.writeFileSync(
        snapshot === typechoSnapshot ? typechoJson : cmsJson,
        `${JSON.stringify(snapshot)}\n`,
      );
    }
    assert.deepEqual(
      compareSnapshotData(
        JSON.parse(fs.readFileSync(cmsJson, 'utf8')),
        JSON.parse(fs.readFileSync(typechoJson, 'utf8')),
      ).differences,
      [],
    );

    const typechoWork = path.join(work, 'typecho-site');
    const cmsWork = path.join(work, 'cms-site');
    const typechoBuilt = shadowBuild(typechoWork, typechoJson, routeMap, metaMap);
    assert.equal(typechoBuilt.status, 0, typechoBuilt.stderr);
    const cmsBuilt = shadowBuild(cmsWork, cmsJson, routeMap, metaMap);
    assert.equal(cmsBuilt.status, 0, cmsBuilt.stderr);
    const dist = compareDistDirs(
      path.join(typechoWork, 'site', 'astro', 'dist'),
      path.join(cmsWork, 'site', 'astro', 'dist'),
    );
    assert.deepEqual(dist.missing, []);
    assert.deepEqual(dist.hashDifferences, []);
    assert.equal(dist.equal, true);
    assert.equal(fs.existsSync(path.join(root, 'astro', 'dist')), false);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(repoRoute)).digest('hex'), routeBefore);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(repoMeta)).digest('hex'), metaBefore);
  } finally {
    await cms.end();
    await typecho.end();
  }
});
