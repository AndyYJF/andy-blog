import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import { applyBootstrap } from '../cms/src/lib/import-apply.js';
import { applyRestore } from '../cms/src/lib/restore-typecho.js';
import { readBuildSnapshot } from './lib/content-source.js';
import { compareSnapshotData } from './lib/cms-contract.js';
import { compensatePublish, compensateTranslation, sourceHash } from './lib/i18n-store.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const fixtureDir = path.resolve(ROOT, 'docs/cms/fixtures/migration/positive/tables');
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

function fileHashes(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else {
        const rel = path.relative(dir, full).replaceAll('\\', '/');
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  };
  walk(dir);
  return out;
}

test('the same package produces equal Typecho and CMS build snapshots', async (t) => {
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
  const packageRows = loadPackage();
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
    await applyBootstrap(cms, packageRows, {
      packageId: 'fixture-positive',
      source: 'synthetic-sanitized-fixture',
    });
    await applyRestore(typecho, packageRows);

    const cmsSnapshot = await readBuildSnapshot(cms, { source: 'cms', epoch: EPOCH });
    const typechoSnapshot = await readBuildSnapshot(typecho, { source: 'typecho', epoch: EPOCH });
    const report = compareSnapshotData(cmsSnapshot, typechoSnapshot);
    assert.deepEqual(report.differences, []);
    assert.equal(report.equal, true);
    assert.equal(cmsSnapshot.i18n.versions.some((row) => Number(row.version_id) === 11), false);
    for (const snapshot of [cmsSnapshot, typechoSnapshot]) {
      for (const field of snapshot.fields) {
        if (Number(field.cid) === 7 && field.name === 'moment_topics') field.str_value = '["示例"]';
      }
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-snap-'));
    const cmsJson = path.join(work, 'cms.json');
    const typechoJson = path.join(work, 'typecho.json');
    fs.writeFileSync(cmsJson, `${JSON.stringify(cmsSnapshot)}\n`);
    fs.writeFileSync(typechoJson, `${JSON.stringify(typechoSnapshot)}\n`);
    const routeMapPath = path.join(work, 'route-map.json');
    const metaMapPath = path.join(work, 'meta-route-map.json');
    fs.writeFileSync(routeMapPath, `${JSON.stringify({
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
    fs.writeFileSync(metaMapPath, '{}\n');
    const routeBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data', 'route-map.json'))).digest('hex');
    const metaBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data', 'meta-route-map.json'))).digest('hex');
    const cmsOut = path.join(work, 'cms-md');
    const typechoOut = path.join(work, 'typecho-md');
    for (const [fixture, out] of [[cmsJson, cmsOut], [typechoJson, typechoOut]]) {
      execFileSync(process.execPath, ['scripts/sync-typecho.js'], {
        cwd: ROOT,
        env: {
          ...process.env,
          SNAPSHOT_EPOCH: String(EPOCH),
          FIXTURE_PATH: fixture,
          CONTENT_BACKUP_DIR: out,
          ROUTE_MAP_PATH: routeMapPath,
          META_ROUTE_MAP_PATH: metaMapPath,
          DB_HOST: '',
          CONTENT_SOURCE: '',
        },
        encoding: 'utf8',
        timeout: 60000,
      });
    }
    assert.deepEqual(fileHashes(cmsOut), fileHashes(typechoOut));
    const selection = JSON.parse(fs.readFileSync(path.join(cmsOut, 'manifests', 'i18n-selection.json'), 'utf8'));
    const routes = JSON.parse(fs.readFileSync(path.join(cmsOut, 'manifests', 'route-map.json'), 'utf8'));
    assert.equal(selection.snapshotEpoch, EPOCH);
    assert.ok(Array.isArray(selection.entries));
    assert.equal(routes['1'].canonicalPath, '/about-sample/');
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data', 'route-map.json'))).digest('hex'),
      routeBefore,
    );
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data', 'meta-route-map.json'))).digest('hex'),
      metaBefore,
    );

    const momentHash = sourceHash('闲话示例', '<!--markdown-->闲话示例\n');
    const htmlHash = sourceHash('HTML 存量', '<p>存量 HTML</p>');
    await cms.query(
      `INSERT INTO cms_i18n_source_state
         (cid, source_revision, source_hash, visibility, content_type, saved_at)
       VALUES (7, 1, ?, 'publish', 'post', 1700000105),
              (8, 1, ?, 'publish', 'post', 1700000106)`,
      [momentHash, htmlHash],
    );
    await cms.query(
      `INSERT INTO cms_i18n_translation_head
         (cid, locale, translation_revision, approved_version_id, publication_state, equivalence_state, updated_at)
       VALUES (7, 'en', 1, 10, 'enabled', 'equivalent', 1700000105)`,
    );
    await compensateTranslation(cms, 'cms_', ['en']);
    await compensatePublish(cms, 'cms_');
    const [momentJobs] = await cms.query('SELECT job_id FROM cms_i18n_translation_job WHERE cid = 7');
    const [htmlJobs] = await cms.query('SELECT job_id FROM cms_i18n_translation_job WHERE cid = 8');
    const [momentEvents] = await cms.query('SELECT event_id FROM cms_i18n_publish_outbox WHERE cid = 7');
    assert.equal(momentJobs.length, 0);
    assert.equal(htmlJobs.length, 1);
    assert.equal(momentEvents.length, 0);
  } finally {
    await cms.end();
    await typecho.end();
  }
});
