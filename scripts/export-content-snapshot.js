#!/usr/bin/env node
/**
 * Build-snapshot export. Default source is Typecho via DB_*.
 * CONTENT_SOURCE=cms reads CMS_DB_* only and refuses a different DB_HOST or DB_NAME.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertContentSourceGroup } from './lib/content-source-launch.js';
import { readBuildSnapshot } from './lib/content-source.js';
import { safeIntegerTypeCast } from './lib/json-safe.js';

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const epochRaw = process.env.SNAPSHOT_EPOCH;
const outPath = process.env.EXPORT_SNAPSHOT_JSON;
if (!/^\d{10}$/.test(epochRaw || '')) {
  fail(64, 'SNAPSHOT_EPOCH is required (10-digit unix seconds)');
}
if (!outPath || outPath.includes('..') || !path.isAbsolute(outPath)) {
  fail(64, 'EXPORT_SNAPSHOT_JSON must be an absolute path without ..');
}

let group;
try {
  group = assertContentSourceGroup();
} catch (error) {
  fail(65, error instanceof Error ? error.message : 'content source refused');
}

let host;
let user;
let password;
let database;
let port;
if (group.source === 'cms') {
  if (process.env.DB_HOST && process.env.DB_HOST !== process.env.CMS_DB_HOST) {
    fail(65, 'cms snapshot export refuses a different DB_HOST');
  }
  if (process.env.DB_NAME && process.env.DB_NAME !== process.env.CMS_DB_NAME) {
    fail(65, 'cms snapshot export refuses a different DB_NAME');
  }
  host = process.env.CMS_DB_HOST;
  user = process.env.CMS_RO_DB_USER;
  password = process.env.CMS_RO_DB_PASSWORD;
  database = process.env.CMS_DB_NAME;
  port = Number(process.env.CMS_DB_PORT || 3306);
} else {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[key]) fail(64, `${key} is required`);
  }
  host = process.env.DB_HOST;
  user = process.env.DB_USER;
  password = process.env.DB_PASSWORD;
  database = process.env.DB_NAME;
  port = Number(process.env.DB_PORT || 3306);
}

const epoch = Number(epochRaw);
const mysql = await import('mysql2/promise');
const db = await mysql.createConnection({
  host,
  port,
  user,
  password,
  database,
  charset: 'utf8mb4',
  connectTimeout: 2000,
  typeCast: safeIntegerTypeCast,
});

try {
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const [[clock]] = await db.query('SELECT UNIX_TIMESTAMP() dbNow');
  if (!Number.isSafeInteger(epoch) || epoch > clock.dbNow) {
    throw new Error('invalid/future SNAPSHOT_EPOCH');
  }
  const snapshot = await readBuildSnapshot(db, { source: group.source, epoch });
  await db.commit();
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(outPath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await fs.rename(tmp, outPath);
  process.stdout.write(`${JSON.stringify({ ok: true, source: group.source, snapshotEpoch: epoch })}\n`);
} catch (err) {
  try { await db.rollback(); } catch { /* already closed */ }
  console.error(err instanceof Error ? err.message : 'export failed');
  process.exit(65);
} finally {
  await db.end();
}
