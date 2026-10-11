import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deleteContent, ensureCmsSchema, getContent, saveContent, sha256Text } from '../cms/src/lib/content-store.js';
import { approveTranslation } from '../cms/src/lib/i18n-edit.js';
import { applyBootstrap } from '../cms/src/lib/import-apply.js';
import { claimDue } from '../cms/src/lib/publish-outbox.js';
import { refreshShadow } from '../cms/src/lib/shadow-sync.js';
import { claimJob } from './lib/i18n-store.js';

const fixtureDir = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/tables');
const uploadRoot = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/uploads/files');

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

test('shadow sync mirrors a read-only export and refuses editorial writes', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_shadow_src');
  await root.query('DROP DATABASE IF EXISTS cms_shadow');
  await root.query('CREATE DATABASE cms_shadow_src CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query('CREATE DATABASE cms_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const source = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_shadow_src',
  });
  const shadow = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_shadow',
  });
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_shadow',
  });
  const packageDir = path.join(os.tmpdir(), `cms-shadow-${process.pid}`);
  try {
    await ensureCmsSchema(source);
    await applyBootstrap(source, loadPackage(), { packageId: 'positive', source: 'shadow-test' });
    const before = await getContent(source, 2);
    const first = await refreshShadow(source, shadow, packageDir, uploadRoot);
    assert.equal(first.counts.contents, 10);
    assert.equal((await getContent(source, 2)).text, before.text);
    const [mode] = await shadow.query('SELECT mode, package_id FROM cms_runtime WHERE id = 1');
    assert.equal(mode[0].mode, 'shadow');
    assert.equal(mode[0].package_id, path.basename(packageDir));
    const [run] = await shadow.query(
      `SELECT status, source, row_counts FROM cms_import_runs ORDER BY run_id DESC LIMIT 1`,
    );
    assert.equal(run[0].status, 'complete');
    assert.equal(run[0].source, 'shadow-sync');
    const counts = typeof run[0].row_counts === 'string' ? JSON.parse(run[0].row_counts) : run[0].row_counts;
    assert.equal(counts.contents, 10);

    const refused = await saveContent(shadow, {
      cid: 2, baseRevision: 1, title: '不能改', slug: 'sample-post', text: '改了',
    });
    assert.equal(refused.status, 403);
    assert.equal((await getContent(shadow, 2)).text, before.text);
    const approval = await approveTranslation(shadow, {
      cid: 2, locale: 'en', versionId: 11, digest: 'a'.repeat(64), proofreader: 'human:1',
    });
    assert.equal(approval.status, 403);
    const [head] = await shadow.query(
      `SELECT approved_version_id FROM cms_i18n_translation_head WHERE cid = 2 AND locale = 'en'`,
    );
    assert.equal(Number(head[0].approved_version_id), 10);
    await assert.rejects(
      () => claimDue(shadow, { owner: 'shadow', now: Math.floor(Date.now() / 1000) }),
      /shadow database refuses writes/,
    );
    await assert.rejects(() => claimJob(pool, 'cms_', 'shadow-worker'), /shadow database refuses writes/);
    const [job] = await shadow.query(
      `SELECT status FROM cms_i18n_translation_job WHERE job_id = 1`,
    );
    assert.equal(job[0].status, 'queued');

    await shadow.query(
      `INSERT INTO cms_contents
        (cid, title, slug, created, modified, text, type, status, revision, text_sha256)
       VALUES (99, 'drift', 'drift', 1, 1, 'drift', 'post', 'publish', 1, ?)`,
      [sha256Text('drift')],
    );
    const sourceRow = await getContent(source, 9);
    const removed = await deleteContent(source, { cid: 9, baseRevision: sourceRow.revision });
    assert.equal(removed.ok, true);
    const second = await refreshShadow(source, shadow, packageDir, uploadRoot);
    assert.equal(second.counts.contents, 9);
    const [gone] = await shadow.query('SELECT cid FROM cms_contents WHERE cid IN (9, 99) ORDER BY cid');
    assert.equal(gone.length, 0);
    const [kept] = await shadow.query('SELECT cid FROM cms_contents WHERE cid = 2');
    assert.equal(kept.length, 1);
    const [runs] = await shadow.query(
      `SELECT COUNT(*) AS n FROM cms_import_runs WHERE status = 'complete' AND source = 'shadow-sync'`,
    );
    assert.equal(Number(runs[0].n), 2);
  } finally {
    await pool.end();
    await source.end();
    await shadow.end();
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});
