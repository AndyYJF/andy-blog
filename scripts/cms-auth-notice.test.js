import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

test('recovery notices list the action and time without the stored detail', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_authnote');
  await root.query('CREATE DATABASE cms_authnote CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_authnote.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_authnote',
  });
  await ensureCmsSchema(setup);
  await setup.query(
    `INSERT INTO cms_audit_log (created_at, actor, action, detail)
     VALUES (1700000001, 'local', 'auth.recover', ?),
            (1700000002, 'local', 'content.save', ?)`,
    [JSON.stringify({ leaked: 'secret-value' }), JSON.stringify({ title: 'nope' })],
  );
  await setup.end();
  await root.end();

  process.env.CMS_DB_HOST = '127.0.0.1';
  process.env.CMS_DB_PORT = '3307';
  process.env.CMS_DB_USER = 'cms';
  process.env.CMS_DB_PASSWORD = 'cms-dev';
  process.env.CMS_DB_NAME = 'cms_authnote';
  const { GET } = await import('../cms/src/pages/api/auth/notices.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  try {
    const response = await GET();
    const text = await response.text();
    assert.equal(response.status, 200, text);
    assert.equal(text.includes('secret-value'), false);
    assert.equal(text.includes('content.save'), false);
    const body = JSON.parse(text);
    assert.deepEqual(body.notices, [{ action: 'auth.recover', createdAt: 1700000001 }]);
  } finally {
    await closeCmsDb();
  }
});
