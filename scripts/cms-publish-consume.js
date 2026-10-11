#!/usr/bin/env node
/**
 * One shot for the generic publish queue.
 * Claims due rows, commits that claim, then POSTs the existing webhook body.
 * The body has no i18n key. 202 is recorded as accepted and is not a live revision.
 * This process refuses any database or rebuild URL that is not loopback.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { assertLocalDbHost } from '../cms/src/lib/content-store.js';
import { claimDue, deliverClaimed } from '../cms/src/lib/publish-outbox.js';

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const host = process.env.DB_HOST || '';
const database = process.env.DB_NAME || '';
const endpoint = process.env.REBUILD_ENDPOINT || '';
const secretFile = process.env.WEBHOOK_SECRET_FILE || '';
if (!host || !database || !endpoint || !secretFile) {
  fail(64, 'DB_HOST, DB_NAME, REBUILD_ENDPOINT, and WEBHOOK_SECRET_FILE are required');
}
try {
  assertLocalDbHost(host);
} catch (error) {
  fail(65, error instanceof Error ? error.message : 'refuses a non-local database');
}
if (!/^cms($|_)/.test(database)) fail(65, 'publish consumer refuses a database outside local cms names');
let rebuildUrl;
try {
  rebuildUrl = new URL(endpoint);
} catch {
  fail(65, 'REBUILD_ENDPOINT is not a URL');
}
if (rebuildUrl.hostname !== '127.0.0.1' && rebuildUrl.hostname !== 'localhost' && rebuildUrl.hostname !== '::1') {
  fail(65, 'publish consumer refuses a non-local rebuild endpoint');
}
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[key];
}
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.NODE_USE_ENV_PROXY = '0';
const secret = fs.readFileSync(secretFile, 'utf8').trim();
if (!secret) fail(64, 'webhook secret is empty');

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
const owner = process.env.CONSUMER_ID || `cms-publish-consume-${process.pid}`;
const now = Math.floor(Date.now() / 1000);
try {
  const claimed = await claimDue(db, { owner, now, leaseSeconds: 30 });
  const results = await deliverClaimed(claimed, {
    now,
    owner,
    db,
    nonceFor: () => crypto.randomBytes(16).toString('hex'),
    send: async (body) => {
      const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
      const response = await fetch(rebuildUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': signature },
        body,
        signal: AbortSignal.timeout(5000),
      });
      return response.status;
    },
  });
  process.stdout.write(`${JSON.stringify({ claimed: claimed.length, results })}\n`);
} catch (error) {
  if (error && error.status === 403) fail(65, error.message);
  fail(1, error instanceof Error ? error.message : 'publish consumer failed');
} finally {
  await db.end();
}
