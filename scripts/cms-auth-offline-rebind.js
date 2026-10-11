#!/usr/bin/env node
/**
 * Prints one short-lived offline rebind secret and stores only its hash.
 * This does not delete the admin or open registration.
 * The command refuses any database that is not a local cms name.
 */
import { assertLocalDbHost } from '../cms/src/lib/content-store.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import { issueOfflineRebind } from '../cms/src/lib/auth-totp.js';

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const host = process.env.DB_HOST || '';
const database = process.env.DB_NAME || '';
if (!host || !database) fail(64, 'DB_HOST and DB_NAME are required');
try {
  assertLocalDbHost(host);
} catch (error) {
  fail(65, error instanceof Error ? error.message : 'refuses a non-local database');
}
if (!/^cms($|_)/.test(database)) fail(65, 'offline rebind refuses a database outside local cms names');

const mysql = await import('mysql2/promise');
const db = await mysql.createConnection({
  host,
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  database,
  charset: 'utf8mb4',
  connectTimeout: 2000,
});
try {
  await ensureCmsSchema(db);
  const issued = await issueOfflineRebind(db);
  if (!issued.ok) fail(issued.status, issued.error);
  process.stdout.write(`${issued.secret}\n`);
} catch (error) {
  fail(1, error instanceof Error ? error.message : 'offline rebind failed');
} finally {
  await db.end();
}
