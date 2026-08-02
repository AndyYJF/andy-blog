import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 9000);
const RUNTIME = process.env.RUNTIME_DIR || '/runtime/build';
const SECRET_FILE = process.env.WEBHOOK_SECRET_FILE || '/run/secrets/webhook_secret';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 4096);
const SKEW_SECONDS = Number(process.env.SKEW_SECONDS || 300);
const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS || 60_000);
const NONCE_TTL_MS = Number(process.env.NONCE_TTL_MS || 10 * 60_000);

const PATHS = {
  pending: path.join(RUNTIME, 'pending'),
  dirty: path.join(RUNTIME, 'dirty'),
  building: path.join(RUNTIME, 'building'),
  nonces: path.join(RUNTIME, 'nonces.json'),
  state: path.join(RUNTIME, 'api-state.json'),
  spool: path.join(RUNTIME, 'spool'),
};

/** Serialize nonce/flag mutations within one process (unique tmp names across concurrent awaits). */
let writeChain = Promise.resolve();
function withWriteLock(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function uniqueTmp(target) {
  return `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
}

function readSecret() {
  const secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  if (!secret) throw new Error('webhook secret empty');
  return secret;
}

function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySignature(rawBody, header, secret) {
  if (!header || !header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(provided, expected);
}

async function ensureRuntime() {
  await fsp.mkdir(RUNTIME, { recursive: true });
  await fsp.mkdir(PATHS.spool, { recursive: true });
  for (const file of [PATHS.pending, PATHS.dirty, PATHS.building, PATHS.nonces, PATHS.state]) {
    try {
      await fsp.access(file);
    } catch {
      if (file.endsWith('.json')) {
        await fsp.writeFile(file, file.endsWith('nonces.json') ? '{}\n' : '{}\n', 'utf8');
      }
    }
  }
}

async function loadNonces() {
  try {
    return JSON.parse(await fsp.readFile(PATHS.nonces, 'utf8'));
  } catch {
    return {};
  }
}

async function saveNonces(map) {
  const tmp = uniqueTmp(PATHS.nonces);
  await fsp.writeFile(tmp, `${JSON.stringify(map)}\n`, 'utf8');
  await fsp.rename(tmp, PATHS.nonces);
}

async function rememberNonce(nonce) {
  return withWriteLock(async () => {
    const now = Date.now();
    const map = await loadNonces();
    for (const [key, ts] of Object.entries(map)) {
      if (now - Number(ts) > NONCE_TTL_MS) delete map[key];
    }
    if (map[nonce]) return false;
    map[nonce] = now;
    await saveNonces(map);
    return true;
  });
}

async function writeFlag(file, payload) {
  return withWriteLock(async () => {
    const tmp = uniqueTmp(file);
    await fsp.writeFile(tmp, `${JSON.stringify(payload)}\n`, 'utf8');
    await fsp.rename(tmp, file);
  });
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enqueue a rebuild request.
 * - Always durable: write pending (or dirty if a build is in flight).
 * - Trailing debounce is recorded in api-state; the host control plane
 *   watches pending/dirty and owns the actual timer + flock.
 */
export async function enqueue(rawBody, signatureHeader) {
  const secret = readSecret();
  if (!verifySignature(rawBody, signatureHeader, secret)) {
    const err = new Error('bad signature');
    err.status = 401;
    throw err;
  }
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    const err = new Error('body too large');
    err.status = 413;
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    const err = new Error('invalid json');
    err.status = 400;
    throw err;
  }

  const ts = Number(payload.ts);
  const nonce = String(payload.nonce || '');
  if (!Number.isFinite(ts) || !/^[0-9a-f]{32}$/.test(nonce)) {
    const err = new Error('bad payload');
    err.status = 400;
    throw err;
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > SKEW_SECONDS) {
    const err = new Error('timestamp skew');
    err.status = 401;
    throw err;
  }
  if (!(await rememberNonce(nonce))) {
    const err = new Error('replay');
    err.status = 401;
    throw err;
  }

  const event = {
    event: payload.event || 'typecho-content-changed',
    receivedAt: new Date().toISOString(),
    ts,
    nonce,
    debounceMs: DEBOUNCE_MS,
  };

  if (await exists(PATHS.building)) {
    await writeFlag(PATHS.dirty, event);
    return { status: 202, body: { accepted: true, mode: 'dirty' } };
  }

  await writeFlag(PATHS.pending, event);
  // Touch a spool marker the host path unit can watch.
  const spoolName = `job-${ts}-${nonce.slice(0, 8)}.json`;
  await writeFlag(path.join(PATHS.spool, spoolName), {
    kind: 'rebuild',
    ...event,
  });
  return { status: 202, body: { accepted: true, mode: 'pending', spool: spoolName } };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const err = new Error('body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'POST' && req.url === '/hooks/rebuild') {
        const raw = await readBody(req);
        const result = await enqueue(raw, req.headers['x-signature']);
        res.writeHead(result.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result.body));
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      const status = error.status || 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'error' }));
    }
  });
}

async function main() {
  await ensureRuntime();
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.error(`rebuild-api listening on ${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export const _internal = { PATHS, verifySignature, ensureRuntime };
