import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonSafeInteger, safeIntegerTypeCast } from './lib/json-safe.js';

test('an integer past the safe range is rejected with its original digits', async (t) => {
  const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
  assert.equal(jsonSafeInteger(42n), 42);
  assert.throws(() => jsonSafeInteger(tooBig), /9007199254740993/);

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
  await root.query('DROP DATABASE IF EXISTS cms_wideint');
  await root.query('CREATE DATABASE cms_wideint CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const admin = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_wideint',
  });
  const checked = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_wideint',
    typeCast: safeIntegerTypeCast,
  });
  try {
    await admin.query('CREATE TABLE wide_id (id BIGINT UNSIGNED PRIMARY KEY, note VARCHAR(32) NULL)');
    await admin.query('INSERT INTO wide_id (id, note) VALUES (9007199254740993, ?)', ['1']);
    await assert.rejects(
      () => checked.query('SELECT id, note FROM wide_id'),
      /9007199254740993/,
    );
    await checked.end();
    const again = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_wideint',
      typeCast: safeIntegerTypeCast,
    });
    try {
      await admin.query('DELETE FROM wide_id');
      await admin.query('INSERT INTO wide_id (id, note) VALUES (42, ?)', ['1']);
      const [rows] = await again.query('SELECT id, note FROM wide_id');
      assert.equal(rows[0].id, 42);
      assert.equal(rows[0].note, '1');
    } finally {
      await again.end();
    }
  } finally {
    try { await checked.end(); } catch { /* the rejected read already closed it */ }
    await admin.end();
  }
});
