import assert from 'node:assert/strict';
import test from 'node:test';

function call(handler, url, params, body, method) {
  return handler({
    params,
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

test('content and meta HTTP handlers write the isolated database', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_http');
  await root.query('CREATE DATABASE cms_http CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_http.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  await root.end();

  process.env.CMS_DB_HOST = '127.0.0.1';
  process.env.CMS_DB_PORT = '3307';
  process.env.CMS_DB_USER = 'cms';
  process.env.CMS_DB_PASSWORD = 'cms-dev';
  process.env.CMS_DB_NAME = 'cms_http';
  const { PUT, DELETE } = await import('../cms/src/pages/api/contents/[cid].js');
  const { POST } = await import('../cms/src/pages/api/metas/index.js');
  const metaRoute = await import('../cms/src/pages/api/metas/[mid].js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_http',
  });
  try {
    const created = await call(POST, 'http://127.0.0.1:4322/api/metas', {}, {
      name: '分类', slug: 'http-cat', type: 'category',
    }, 'POST');
    const createdText = await created.text();
    assert.equal(created.status, 200, createdText);
    const meta = JSON.parse(createdText);
    const saved = await call(PUT, 'http://127.0.0.1:4322/api/contents/8', { cid: '8' }, {
      text: '<!--markdown-->接口文章\n',
      baseRevision: 0,
      title: '接口文章',
      slug: 'http-post',
      type: 'post',
      status: 'publish',
      relationshipMids: [meta.mid],
    }, 'PUT');
    assert.equal(saved.status, 200, await saved.clone().text());
    const stale = await call(metaRoute.DELETE, 'http://127.0.0.1:4322/api/metas/1', { mid: String(meta.mid) }, {
      baseSlug: 'other',
    }, 'DELETE');
    assert.equal(stale.status, 409);
    const removed = await call(DELETE, 'http://127.0.0.1:4322/api/contents/8', { cid: '8' }, {
      baseRevision: 1,
    }, 'DELETE');
    assert.equal(removed.status, 200, await removed.clone().text());
    const [left] = await db.query('SELECT COUNT(*) AS n FROM cms_contents WHERE cid = 8');
    const [event] = await db.query(
      `SELECT op FROM cms_publish_outbox WHERE cid = 8 ORDER BY event_id DESC LIMIT 1`,
    );
    assert.equal(Number(left[0].n), 0);
    assert.equal(event[0].op, 'delete');
    const gone = await call(metaRoute.DELETE, 'http://127.0.0.1:4322/api/metas/1', { mid: String(meta.mid) }, {
      baseSlug: 'http-cat',
    }, 'DELETE');
    assert.equal(gone.status, 200, await gone.clone().text());
    const [metas] = await db.query('SELECT COUNT(*) AS n FROM cms_metas');
    assert.equal(Number(metas[0].n), 0);
  } finally {
    await db.end();
    await closeCmsDb();
  }
});
