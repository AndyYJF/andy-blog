#!/usr/bin/env node
/**
 * Cheap Typecho snapshot export for off-box builds.
 * Runs in the VPS builder container (MySQL only). Writes JSON; no site compile.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

function jsonSafeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (Buffer.isBuffer(value)) out[key] = value.toString('utf8');
    else if (value instanceof Date) out[key] = Math.floor(value.getTime() / 1000);
    else out[key] = value ?? null;
  }
  return out;
}

const epochRaw = process.env.SNAPSHOT_EPOCH;
const outPath = process.env.EXPORT_SNAPSHOT_JSON;
if (!/^\d{10}$/.test(epochRaw || '')) {
  console.error('SNAPSHOT_EPOCH is required (10-digit unix seconds)');
  process.exit(64);
}
if (!outPath || !outPath.startsWith('/') || outPath.includes('..')) {
  console.error('EXPORT_SNAPSHOT_JSON must be an absolute path without ..');
  process.exit(64);
}

const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exit(64);
  }
}

const epoch = Number(epochRaw);
const mysql = await import('mysql2/promise');
const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
});

try {
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const [[clock]] = await db.query('SELECT UNIX_TIMESTAMP() dbNow');
  if (!Number.isSafeInteger(epoch) || epoch > clock.dbNow) {
    throw new Error('invalid/future SNAPSHOT_EPOCH');
  }
  const [contents] = await db.query(
    `SELECT cid, type, title, slug, text, created, modified,
            allowComment, allowFeed, \`order\`, template, password, status
     FROM typecho_contents
     WHERE type IN ('post','page')
     ORDER BY cid`,
  );
  const [relations] = await db.query(
    `SELECT r.cid, m.mid, m.name, m.slug, m.type, m.\`order\`
     FROM typecho_relationships r
     JOIN typecho_metas m ON m.mid=r.mid
     ORDER BY r.cid, m.type, m.\`order\`, m.mid`,
  );
  const [fields] = await db.query(
    `SELECT cid, name, type, str_value, int_value, float_value
     FROM typecho_fields ORDER BY cid, name`,
  );
  const [metas] = await db.query(
    `SELECT mid, name, slug, type, description, count, \`order\`
     FROM typecho_metas WHERE type IN ('category','tag')
     ORDER BY type, \`order\`, mid`,
  );
  await db.commit();

  const snapshot = {
    snapshotEpoch: epoch,
    contents: contents.map(jsonSafeRow),
    relations: relations.map(jsonSafeRow),
    fields: fields.map(jsonSafeRow),
    metas: metas.map(jsonSafeRow),
  };
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(outPath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await fs.rename(tmp, outPath);
  process.stdout.write(`${JSON.stringify({ ok: true, snapshotEpoch: epoch })}\n`);
} catch (err) {
  try { await db.rollback(); } catch {}
  console.error(err instanceof Error ? err.message : 'export failed');
  process.exit(65);
} finally {
  await db.end();
}
