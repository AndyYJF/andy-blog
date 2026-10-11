import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ensureCmsSchema } from '../cms/src/lib/content-store.js';
import { MOCK_IMAGE_MAX_EDGE, storeMockImage } from '../cms/src/lib/media-mock.js';

const sharp = createRequire(new URL('../cms/package.json', import.meta.url))('sharp');

async function stillImage(format) {
  const image = sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 10, g: 20, b: 30 } },
  });
  return format === 'jpeg' ? image.jpeg().toBuffer() : image.png().toBuffer();
}

test('the image mock never calls a provider and the shadow database refuses it', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_media_mock');
  await root.query('CREATE DATABASE cms_media_mock CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_media_mock',
  });
  try {
    await ensureCmsSchema(db);
    const jpeg = await stillImage('jpeg');
    const png = await stillImage('png');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const gif = Buffer.from('GIF89a');
    const stored = await storeMockImage(db, jpeg);
    assert.equal(stored.ok, true);
    assert.equal(stored.provider, 'unverified');
    assert.equal(stored.url.startsWith('mock://unverified/'), true);
    assert.equal(stored.width, 1);
    assert.equal(stored.height, 1);
    assert.equal(stored.mime, 'image/jpeg');
    const again = await storeMockImage(db, jpeg);
    assert.equal(again.deduped, true);
    assert.equal(again.mediaId, stored.mediaId);
    assert.equal(again.width, 1);
    assert.equal((await storeMockImage(db, svg)).status, 400);
    assert.equal((await storeMockImage(db, gif)).status, 400);
    assert.equal((await storeMockImage(db, png)).mime, 'image/png');
    const apng = Buffer.concat([png, Buffer.from('acTL')]);
    assert.equal((await storeMockImage(db, apng)).status, 400);
    const wide = await sharp({
      create: { width: MOCK_IMAGE_MAX_EDGE + 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    const tooWide = await storeMockImage(db, wide);
    assert.equal(tooWide.status, 400);
    assert.equal(tooWide.error, 'image pixel size is outside the mock limit');
    const [rows] = await db.query('SELECT COUNT(*) AS n FROM cms_media');
    assert.equal(Number(rows[0].n), 2);

    await db.query(
      `INSERT INTO cms_runtime (id, mode, package_id, updated_at) VALUES (1, 'shadow', 'media', 1)`,
    );
    const blocked = await storeMockImage(db, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xd9]));
    assert.equal(blocked.status, 403);
    const [after] = await db.query('SELECT COUNT(*) AS n FROM cms_media');
    assert.equal(Number(after[0].n), 2);
  } finally {
    await db.end();
  }
});
