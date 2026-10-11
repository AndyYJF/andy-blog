import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCmsSchema, ensureCmsSchema } from '../cms/src/lib/schema.js';

test('schema steps record a version only after they finish and the app user cannot run DDL', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_ddl');
  await root.query('CREATE DATABASE cms_ddl CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("DROP USER IF EXISTS 'cms_schema_app'@'127.0.0.1'");
  await root.query("DROP USER IF EXISTS 'cms_schema_migrate'@'127.0.0.1'");
  await root.query("CREATE USER 'cms_schema_app'@'127.0.0.1' IDENTIFIED BY 'cms-schema-app'");
  await root.query("CREATE USER 'cms_schema_migrate'@'127.0.0.1' IDENTIFIED BY 'cms-schema-migrate'");
  await root.query("GRANT SELECT, INSERT, UPDATE, DELETE ON cms_ddl.* TO 'cms_schema_app'@'127.0.0.1'");
  await root.query("GRANT ALL PRIVILEGES ON cms_ddl.* TO 'cms_schema_migrate'@'127.0.0.1'");
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_ddl',
  });
  let app;
  let migrate;
  try {
    await ensureCmsSchema(db);
    await assert.rejects(
      () => applyCmsSchema(db, [{ version: 902, statements: ['SELECT this_is_not_valid'] }]),
      /this_is_not_valid/,
    );
    await assert.rejects(
      () => applyCmsSchema(db, [{
        version: 903,
        statements: [
          'CREATE TABLE IF NOT EXISTS cms_ddl_partial (id INT PRIMARY KEY)',
          'SELECT this_is_not_valid',
        ],
      }]),
      /this_is_not_valid/,
    );
    const [partial] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'cms_ddl' AND TABLE_NAME = 'cms_ddl_partial'`,
    );
    assert.equal(Number(partial[0].n), 1);
    const [missing] = await db.query(
      'SELECT version FROM cms_schema_migrations WHERE version IN (902, 903)',
    );
    assert.equal(missing.length, 0);

    await applyCmsSchema(db, [{
      version: 903,
      statements: ['CREATE TABLE IF NOT EXISTS cms_ddl_partial (id INT PRIMARY KEY)'],
    }]);
    const [once] = await db.query(
      'SELECT applied_at FROM cms_schema_migrations WHERE version = 903',
    );
    assert.equal(once.length, 1);
    await applyCmsSchema(db, [{ version: 903, statements: ['SELECT this_is_not_valid'] }]);
    const [again] = await db.query(
      'SELECT applied_at FROM cms_schema_migrations WHERE version = 903',
    );
    assert.equal(Number(again[0].applied_at), Number(once[0].applied_at));

    app = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'cms_schema_app', password: 'cms-schema-app', database: 'cms_ddl',
    });
    await assert.rejects(
      () => app.query('CREATE TABLE cms_app_should_fail (id INT)'),
      (error) => error && (error.code === 'ER_TABLEACCESS_DENIED_ERROR' || error.code === 'ER_DBACCESS_DENIED_ERROR'),
    );
    migrate = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'cms_schema_migrate', password: 'cms-schema-migrate', database: 'cms_ddl',
    });
    await applyCmsSchema(migrate, [{
      version: 904,
      statements: ['CREATE TABLE IF NOT EXISTS cms_ddl_by_migrate (id INT PRIMARY KEY)'],
    }]);
    await app.query('INSERT INTO cms_ddl_by_migrate (id) VALUES (1)');
    const [written] = await app.query('SELECT id FROM cms_ddl_by_migrate');
    assert.equal(Number(written[0].id), 1);
  } finally {
    if (app) await app.end();
    if (migrate) await migrate.end();
    await db.end();
    const cleanup = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '',
    });
    await cleanup.query("DROP USER IF EXISTS 'cms_schema_app'@'127.0.0.1'");
    await cleanup.query("DROP USER IF EXISTS 'cms_schema_migrate'@'127.0.0.1'");
    await cleanup.end();
  }
});
