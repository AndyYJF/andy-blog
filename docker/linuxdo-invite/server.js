import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTurnstile, readInviteConfig, claimInvite } from './lib.js';

const PORT = Number(process.env.PORT || 8370);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 4096);

const CLAIM_PATHS = new Set(['/', '/claim', '/linuxdo/claim']);

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.socket.remoteAddress || '';
}

export function createServer(deps = {}) {
  const verify = deps.verifyTurnstile || verifyTurnstile;
  const loadConfig = deps.readInviteConfig || readInviteConfig;
  const claim = deps.claimInvite || claimInvite;

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        send(res, 200, { ok: true });
        return;
      }

      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!CLAIM_PATHS.has(url.pathname)) {
        send(res, 404, { ok: false, error: 'not_found' });
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }

      const raw = await readBody(req);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        send(res, 400, { ok: false, error: 'invalid_json' });
        return;
      }

      const token = typeof parsed.turnstileToken === 'string' ? parsed.turnstileToken.trim() : '';
      if (!token) {
        send(res, 400, { ok: false, error: 'missing_token' });
        return;
      }

      const config = loadConfig();
      if (!config.secret || !config.inviteUrl) {
        send(res, 503, { ok: false, error: 'not_configured' });
        return;
      }

      const ok = await verify({
        secret: config.secret,
        token,
        ip: clientIp(req),
        fetchImpl: deps.fetchImpl,
      });
      if (!ok) {
        send(res, 403, { ok: false, error: 'turnstile_failed' });
        return;
      }

      send(res, 200, claim(config));
    } catch (err) {
      const status = err?.status || 500;
      send(res, status, { ok: false, error: status === 413 ? 'body_too_large' : 'internal_error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`linuxdo-invite listening on ${HOST}:${PORT}`);
  });
}
