#!/usr/bin/env node
/**
 * One shot for the collapsed restore rebuild.
 * Unfinished generic publish events become one loopback request.
 * The rows stay in the package. 202 is evidence for that one request, not a live revision.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { MigrationExit, postOwedRebuild, readOwedRebuild } from './lib/cms-migration-cli.js';

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const packageFlag = process.argv.indexOf('--package');
const packageDir = packageFlag === -1 ? '' : process.argv[packageFlag + 1];
const endpoint = process.env.REBUILD_ENDPOINT || '';
const secretFile = process.env.WEBHOOK_SECRET_FILE || '';
if (!packageDir || !endpoint || !secretFile) {
  fail(64, '--package, REBUILD_ENDPOINT, and WEBHOOK_SECRET_FILE are required');
}
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[key];
}
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.NODE_USE_ENV_PROXY = '0';
const secret = fs.readFileSync(secretFile, 'utf8').trim();
const owed = readOwedRebuild(packageDir);
try {
  const report = await postOwedRebuild({
    owed,
    endpoint,
    secret,
    now: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.sent && !report.evidence) fail(65, `owed rebuild was not accepted: HTTP ${report.httpStatus}`);
} catch (error) {
  if (error instanceof MigrationExit) fail(error.code, error.message);
  fail(1, error instanceof Error ? error.message : 'owed rebuild failed');
}
