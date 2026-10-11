import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ensureCmsSchema } from '../cms/src/lib/content-store.js';
import { applyBootstrap, exportPackageTables } from '../cms/src/lib/import-apply.js';

const fixtureDir = path.resolve(import.meta.dirname, '../docs/cms/fixtures/migration/positive/tables');

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

test('a failed import keeps no rows and an unfinished run blocks export', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_import_fail');
  await root.query('CREATE DATABASE cms_import_fail CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_import_fail',
  });
  try {
    await ensureCmsSchema(db);
    const broken = loadPackage();
    broken.contents = [broken.contents[0], { ...broken.contents[0] }];
    await assert.rejects(
      () => applyBootstrap(db, broken, { packageId: 'broken', source: 'import-failure' }),
      /Duplicate/,
    );
    const [empty] = await db.query('SELECT COUNT(*) AS n FROM cms_contents');
    assert.equal(Number(empty[0].n), 0);
    const [failed] = await db.query(
      `SELECT status FROM cms_import_runs WHERE package_id = 'broken'`,
    );
    assert.equal(failed[0].status, 'failed');

    await db.query(
      `INSERT INTO cms_import_runs (package_id, mode, status, source, started_at)
       VALUES ('crash', 'bootstrap', 'staging', 'import-failure', 1)`,
    );
    await assert.rejects(
      () => applyBootstrap(db, loadPackage(), { packageId: 'positive', source: 'import-failure' }),
      /import is incomplete/,
    );
    await assert.rejects(() => exportPackageTables(db), /import is incomplete/);
    const [stillEmpty] = await db.query('SELECT COUNT(*) AS n FROM cms_contents');
    assert.equal(Number(stillEmpty[0].n), 0);

    await db.query(`UPDATE cms_import_runs SET status = 'failed' WHERE package_id = 'crash'`);
    const applied = await applyBootstrap(db, loadPackage(), { packageId: 'positive', source: 'import-failure' });
    assert.equal(applied.runId > 0, true);
    const exported = await exportPackageTables(db);
    const row = exported.contents.find((item) => item.cid === 2);
    assert.equal(row.text, '<!--markdown-->正文示例\n');
    const [open] = await db.query(`SELECT COUNT(*) AS n FROM cms_import_runs WHERE status = 'staging'`);
    assert.equal(Number(open[0].n), 0);
  } finally {
    await db.end();
  }
});
