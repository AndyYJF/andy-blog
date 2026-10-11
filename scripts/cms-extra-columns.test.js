import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import { MigrationExit, exportCmsPackage, runImport } from './lib/cms-migration-cli.js';

test('an unmapped column is kept in the package and blocks import', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_extra');
  await root.query('CREATE DATABASE cms_extra CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_extra',
  });
  const plainDir = path.join(os.tmpdir(), `cms-extra-plain-${process.pid}`);
  const extraDir = path.join(os.tmpdir(), `cms-extra-col-${process.pid}`);
  try {
    await ensureCmsSchema(db);
    const saved = await saveContent(db, {
      cid: 1, baseRevision: 0, title: '额外列', slug: 'extra', text: '<!--markdown-->正文\n', type: 'post_draft',
    });
    assert.equal(saved.ok, true, saved.error);
    await exportCmsPackage(db, plainDir);
    const plain = JSON.parse(fs.readFileSync(path.join(plainDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(plain.extraColumns, {});
    assert.equal(fs.existsSync(path.join(plainDir, 'extra-columns.json')), false);

    await db.query('ALTER TABLE cms_contents ADD COLUMN vendor_flag VARCHAR(8) NULL');
    await db.query('UPDATE cms_contents SET vendor_flag = ? WHERE cid = 1', ['keep-me']);
    await exportCmsPackage(db, extraDir);
    const manifest = JSON.parse(fs.readFileSync(path.join(extraDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.extraColumns.contents, ['vendor_flag']);
    const extras = JSON.parse(fs.readFileSync(path.join(extraDir, 'extra-columns.json'), 'utf8'));
    assert.equal(extras.contents[0].vendor_flag, 'keep-me');
    assert.equal(extras.contents[0].cid, 1);
    const contents = JSON.parse(fs.readFileSync(path.join(extraDir, 'tables/contents.json'), 'utf8'));
    assert.equal(Object.hasOwn(contents[0], 'vendor_flag'), false);
    await assert.rejects(
      () => runImport(['--package', extraDir, '--mode', 'bootstrap']),
      (error) => error instanceof MigrationExit && error.code === 1 && /contents\.vendor_flag/.test(error.message),
    );
  } finally {
    await db.end();
    fs.rmSync(plainDir, { recursive: true, force: true });
    fs.rmSync(extraDir, { recursive: true, force: true });
  }
});
