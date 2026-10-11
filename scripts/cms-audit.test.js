import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { saveContent, deleteContent } from '../cms/src/lib/content-store.js';
import { approveTranslation } from '../cms/src/lib/i18n-edit.js';
import { storeMockImage } from '../cms/src/lib/media-mock.js';
import { saveMeta } from '../cms/src/lib/meta-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('editorial writes append an audit row and a conflict keeps the previous row', async (t) => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../cms/src/lib/audit-log.js'), 'utf8');
  assert.doesNotMatch(source, /UPDATE cms_audit_log|DELETE FROM cms_audit_log/);
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
  await root.query('DROP DATABASE IF EXISTS cms_audit');
  await root.query('CREATE DATABASE cms_audit CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_audit',
  });
  try {
    await ensureCmsSchema(db);
    const saved = await saveContent(db, {
      cid: 1,
      baseRevision: 0,
      title: '口令文',
      slug: 'secret-post',
      text: '<!--markdown-->正文\n',
      password: 'secret-value',
    });
    assert.equal(saved.ok, true, saved.error);
    const conflict = await saveContent(db, {
      cid: 1,
      baseRevision: 0,
      title: '覆盖',
      text: '<!--markdown-->覆盖\n',
      password: 'secret-value',
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.status, 409);
    const removed = await deleteContent(db, { cid: 1, baseRevision: saved.revision });
    assert.equal(removed.ok, true, removed.error);
    const meta = await saveMeta(db, { name: '分类', slug: 'cat', type: 'category' });
    assert.equal(meta.ok, true, meta.error);
    const jpeg = await createRequire(new URL('../cms/package.json', import.meta.url))('sharp')({
      create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();
    const image = await storeMockImage(db, jpeg);
    assert.equal(image.ok, true, image.error);
    const digest = 'a'.repeat(64);
    await db.query(
      `INSERT INTO cms_i18n_translation_head (cid, locale, updated_at) VALUES (1, 'en', 1700000000)`,
    );
    await db.query(
      `INSERT INTO cms_i18n_translation_version
        (version_id, cid, locale, translation_revision, title, body, source_revision, source_hash, content_digest, author, created_at)
       VALUES (10, 1, 'en', 1, 'en', 'body', 1, ?, ?, 'model', 1700000000)`,
      ['b'.repeat(64), digest],
    );
    const mismatch = await approveTranslation(db, {
      cid: 1, locale: 'en', versionId: 10, digest: 'c'.repeat(64), proofreader: 'human:1',
    });
    assert.equal(mismatch.status, 409);
    const approved = await approveTranslation(db, {
      cid: 1, locale: 'en', versionId: 10, digest, proofreader: 'human:1',
    });
    assert.equal(approved.ok, true, approved.error);

    const [rows] = await db.query('SELECT action, cid, detail FROM cms_audit_log ORDER BY audit_id');
    assert.deepEqual(rows.map((row) => row.action), [
      'content.save', 'content.delete', 'meta.save', 'media.store', 'translation.approve',
    ]);
    const packed = JSON.stringify(rows);
    assert.equal(packed.includes('secret-value'), false);
    assert.equal(packed.includes(digest), false);
    const approve = rows.at(-1).detail;
    const approveDetail = typeof approve === 'string' ? JSON.parse(approve) : approve;
    assert.equal(approveDetail.versionId, 10);
    assert.equal(approveDetail.proofreader, 'human:1');
  } finally {
    await db.end();
  }
});
