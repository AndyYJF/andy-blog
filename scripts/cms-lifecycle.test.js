import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { approveTranslation } from '../cms/src/lib/i18n-edit.js';
import { deleteContent, getContent, saveContent } from '../cms/src/lib/content-store.js';

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

function local(database) {
  return {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: database,
    CMS_UPLOAD_ROOT: uploadRoot,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('edits survive a freeze and a deleted article does not come back', async (t) => {
  const mysql = await import('mysql2/promise');
  let rootDb;
  try {
    rootDb = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await rootDb.query('DROP DATABASE IF EXISTS cms_life');
  await rootDb.query('CREATE DATABASE cms_life CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await rootDb.query('CREATE DATABASE IF NOT EXISTS typecho_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await rootDb.end();

  const seeded = run('restore-cms-to-typecho.js', ['--package', fixture, '--execute'], local('typecho_restore'));
  assert.equal(seeded.status, 0, seeded.stderr);

  const imported = run(
    'import-typecho-to-cms.js',
    ['--package', fixture, '--mode', 'bootstrap', '--execute'],
    local('cms_life'),
  );
  assert.equal(imported.status, 0, imported.stderr);

  const cms = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_life',
  });
  const typecho = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'typecho_restore',
  });
  const cmsPkg = path.join(os.tmpdir(), `cms-life-${process.pid}`);
  const typechoPkg = path.join(os.tmpdir(), `typecho-life-${process.pid}`);
  fs.rmSync(cmsPkg, { recursive: true, force: true });
  fs.rmSync(typechoPkg, { recursive: true, force: true });
  try {
    await typecho.query(
      `INSERT INTO typecho_contents (cid, title, slug, created, modified, text, type, status)
       VALUES (990002, 'resurrect', 'resurrect', 1, 1, 'resurrect', 'post', 'publish')`,
    );
    const [present] = await typecho.query(
      'SELECT cid FROM typecho_contents WHERE cid IN (8, 990002) ORDER BY cid',
    );
    assert.deepEqual(present.map((row) => Number(row.cid)), [8, 990002]);

    const page = await getContent(cms, 1);
    const html = await getContent(cms, 8);
    const edited = await saveContent(cms, {
      cid: 1,
      baseRevision: page.revision,
      title: '关于改过',
      slug: page.slug,
      text: '<!--markdown-->改过的关于\n',
      type: 'page',
      status: 'publish',
      fields: [{ name: 'legacy_note', type: 'str', str_value: '生命周期', int_value: null, float_value: null }],
      relationshipMids: [1],
    });
    assert.equal(edited.ok, true, edited.error);
    const created = await saveContent(cms, {
      cid: 80,
      baseRevision: 0,
      title: '新文章',
      slug: 'life-80',
      text: '<!--markdown-->新文章\n',
      type: 'post',
      status: 'publish',
      relationshipMids: [2],
    });
    assert.equal(created.ok, true, created.error);
    const removed = await deleteContent(cms, { cid: 8, baseRevision: html.revision });
    assert.equal(removed.ok, true, removed.error);
    const [version] = await cms.query(
      `SELECT content_digest FROM cms_i18n_translation_version WHERE version_id = 11`,
    );
    const approved = await approveTranslation(cms, {
      cid: 2,
      locale: 'en',
      versionId: 11,
      digest: version[0].content_digest,
      proofreader: 'human:1',
    });
    assert.equal(approved.ok, true, approved.error);

    const exported = run('export-cms-migration.js', ['--package', cmsPkg], local('cms_life'));
    assert.equal(exported.status, 0, exported.stderr);
    const exportReport = JSON.parse(exported.stdout);
    assert.equal(exportReport.controlledRebuild, 1);
    assert.equal(exportReport.retainedPublishEvents >= 3, true);

    const restored = run('restore-cms-to-typecho.js', ['--package', cmsPkg, '--execute'], local('typecho_restore'));
    assert.equal(restored.status, 0, restored.stderr);
    const [gone] = await typecho.query(
      'SELECT COUNT(*) AS n FROM typecho_contents WHERE cid IN (8, 990002)',
    );
    assert.equal(Number(gone[0].n), 0);
    const [kept] = await typecho.query(
      `SELECT title, text FROM typecho_contents WHERE cid IN (1, 80) ORDER BY cid`,
    );
    assert.equal(kept[0].title, '关于改过');
    assert.equal(kept[0].text, '<!--markdown-->改过的关于\n');
    assert.equal(kept[1].title, '新文章');
    const [links] = await typecho.query(
      'SELECT cid, mid FROM typecho_relationships WHERE cid IN (1, 80) ORDER BY cid, mid',
    );
    assert.deepEqual(links.map((row) => [Number(row.cid), Number(row.mid)]), [[1, 1], [80, 2]]);
    const [note] = await typecho.query(
      `SELECT str_value FROM typecho_fields WHERE cid = 1 AND name = 'legacy_note'`,
    );
    assert.equal(note[0].str_value, '生命周期');
    const [head] = await typecho.query(
      `SELECT approved_version_id FROM typecho_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(Number(head[0].approved_version_id), 11);
    const [ledger] = await typecho.query(
      `SELECT translation_available_at FROM typecho_i18n_publication_ledger WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(Number(ledger[0].translation_available_at), 1700000400);

    const again = run('export-typecho-migration.js', ['--package', typechoPkg], local('typecho_restore'));
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).controlledRebuild, 0);
    const names = fs.readdirSync(path.join(cmsPkg, 'tables')).filter((name) => name.endsWith('.json')).sort();
    for (const name of names) {
      assert.deepEqual(
        readJson(path.join(typechoPkg, 'tables', name)),
        readJson(path.join(cmsPkg, 'tables', name)),
        name,
      );
    }
    const events = readJson(path.join(cmsPkg, 'cms-only', 'publish-outbox.json'));
    assert.equal(events.some((row) => Number(row.cid) === 80 && row.op === 'publish'), true);
    assert.equal(events.some((row) => Number(row.cid) === 1 && row.op === 'update'), true);
    assert.equal(events.some((row) => Number(row.cid) === 8 && row.op === 'delete'), true);
    assert.deepEqual(readJson(path.join(typechoPkg, 'cms-only', 'publish-outbox.json')), []);
    assert.deepEqual(readJson(path.join(typechoPkg, 'cms-only', 'change-log.json')), []);
    assert.deepEqual(readJson(path.join(typechoPkg, 'cms-only', 'content-revisions.json')), []);
    const revisions = readJson(path.join(cmsPkg, 'cms-only', 'content-revisions.json'));
    assert.equal(revisions.some((row) => Number(row.cid) === 1), true);
    const log = readJson(path.join(cmsPkg, 'cms-only', 'change-log.json'));
    assert.equal(log.some((row) => Number(row.cid) === 8 && row.op === 'delete'), true);
    const [still] = await cms.query('SELECT COUNT(*) AS n FROM cms_contents WHERE cid = 8');
    assert.equal(Number(still[0].n), 0);
  } finally {
    await cms.end();
    await typecho.end();
  }
});
