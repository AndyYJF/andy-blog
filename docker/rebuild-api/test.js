/**
 * Local unit tests for rebuild-api HMAC / skew / replay / dirty behaviour.
 * Does not require Docker.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = await fsp.mkdtemp(path.join(os.tmpdir(), 'rebuild-api-'));
const secretFile = path.join(runtime, 'secret');
await fsp.writeFile(secretFile, 'test-secret-value\n', 'utf8');

process.env.RUNTIME_DIR = runtime;
process.env.WEBHOOK_SECRET_FILE = secretFile;
process.env.DEBOUNCE_MS = '1000';

const { enqueue, _internal } = await import(pathToFileURL(path.join(root, 'server.js')).href);
await _internal.ensureRuntime();

const secret = 'test-secret-value';
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
const bodyFor = (overrides = {}) =>
  JSON.stringify({
    event: 'typecho-content-changed',
    ts: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex'),
    ...overrides,
  });

// good request → pending
{
  const body = bodyFor();
  const res = await enqueue(body, sign(body));
  assert.equal(res.status, 202);
  assert.equal(res.body.mode, 'pending');
  assert.ok(fs.existsSync(_internal.PATHS.pending));
}

// bad signature
{
  const body = bodyFor();
  await assert.rejects(() => enqueue(body, 'sha256=' + '0'.repeat(64)), /bad signature/);
}

// expired timestamp
{
  const body = bodyFor({ ts: Math.floor(Date.now() / 1000) - 10_000 });
  await assert.rejects(() => enqueue(body, sign(body)), /timestamp skew/);
}

// replay nonce
{
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = bodyFor({ nonce });
  await enqueue(body, sign(body));
  await assert.rejects(() => enqueue(body, sign(body)), /replay/);
}

// dirty while building
{
  await fsp.writeFile(_internal.PATHS.building, JSON.stringify({ startedAt: new Date().toISOString() }), 'utf8');
  const body = bodyFor();
  const res = await enqueue(body, sign(body));
  assert.equal(res.body.mode, 'dirty');
  assert.ok(fs.existsSync(_internal.PATHS.dirty));
  await fsp.rm(_internal.PATHS.building, { force: true });
}

// concurrent distinct nonces must all succeed; no rename ENOENT
{
  const bodies = Array.from({ length: 40 }, () => bodyFor());
  const results = await Promise.allSettled(bodies.map((body) => enqueue(body, sign(body))));
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(
    fulfilled.length,
    40,
    `expected 40 ok, got ${fulfilled.length}; rejects=${rejected.map((r) => r.reason?.message)}`,
  );
  await assert.rejects(() => enqueue(bodies[0], sign(bodies[0])), /replay/);
}

await fsp.rm(runtime, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, runtime }, null, 2));
