import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInviteConfig, claimInvite, createChallengeStore, verifyTurnstile } from './lib.js';

const PORT = Number(process.env.PORT || 8370);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 4096);
const CORS_ORIGINS = new Set(
  String(process.env.LINUXDO_CORS_ORIGINS || 'https://www.andy-y.cn')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const RATE_WINDOW_MS = Number(process.env.LINUXDO_RATE_WINDOW_MS || 60_000);
const RATE_MAX = Number(process.env.LINUXDO_RATE_MAX || 20);

const CHALLENGE_PATHS = new Set(['/challenge', '/linuxdo/challenge']);
const CLAIM_PATHS = new Set(['/', '/claim', '/linuxdo/claim']);

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.socket.remoteAddress || '';
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }
  return { Vary: 'Origin' };
}

function send(req, res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...corsHeaders(req),
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

function createRateLimit({ windowMs = RATE_WINDOW_MS, max = RATE_MAX, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    allow(ip) {
      const t = now();
      const key = ip || 'unknown';
      const row = hits.get(key) || [];
      const fresh = row.filter((ts) => t - ts < windowMs);
      if (fresh.length >= max) {
        hits.set(key, fresh);
        return false;
      }
      fresh.push(t);
      hits.set(key, fresh);
      return true;
    },
  };
}

export function createServer(deps = {}) {
  const loadConfig = deps.readInviteConfig || readInviteConfig;
  const claim = deps.claimInvite || claimInvite;
  const store = deps.challengeStore || createChallengeStore();
  const limiter = deps.rateLimit || createRateLimit();
  const verify = deps.verifyTurnstile || verifyTurnstile;

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...corsHeaders(req),
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && (req.url === '/healthz' || req.url?.startsWith('/healthz?'))) {
        send(req, res, 200, { ok: true });
        return;
      }

      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const ip = clientIp(req);

      if (CHALLENGE_PATHS.has(url.pathname) || CLAIM_PATHS.has(url.pathname)) {
        if (!limiter.allow(ip)) {
          send(req, res, 429, { ok: false, error: 'rate_limited' });
          return;
        }
      }

      if (CHALLENGE_PATHS.has(url.pathname)) {
        if (req.method !== 'GET') {
          send(req, res, 405, { ok: false, error: 'method_not_allowed' });
          return;
        }
        const config = loadConfig();
        if (!config.inviteUrl) {
          send(req, res, 503, { ok: false, error: 'not_configured' });
          return;
        }
        const challenge = store.issue(config.difficulty);
        send(req, res, 200, { ok: true, ...challenge });
        return;
      }

      if (!CLAIM_PATHS.has(url.pathname)) {
        send(req, res, 404, { ok: false, error: 'not_found' });
        return;
      }
      if (req.method !== 'POST') {
        send(req, res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }

      const raw = await readBody(req);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        send(req, res, 400, { ok: false, error: 'invalid_json' });
        return;
      }

      const token = typeof parsed.turnstileToken === 'string' ? parsed.turnstileToken.trim() : '';
      if (!token) {
        send(req, res, 400, { ok: false, error: 'missing_token' });
        return;
      }

      const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
      const nonce = parsed.nonce;
      if (!id || nonce === undefined || nonce === null || nonce === '') {
        send(req, res, 400, { ok: false, error: 'missing_pow' });
        return;
      }

      const config = loadConfig();
      if (!config.secret || !config.inviteUrl) {
        send(req, res, 503, { ok: false, error: 'not_configured' });
        return;
      }

      const human = await verify({
        secret: config.secret,
        token,
        ip,
        fetchImpl: deps.fetchImpl,
      });
      if (!human) {
        send(req, res, 403, { ok: false, error: 'turnstile_failed' });
        return;
      }

      const checked = store.consume(id, nonce);
      if (!checked.ok) {
        const status = checked.error === 'pow_failed' ? 403 : 400;
        send(req, res, status, { ok: false, error: checked.error });
        return;
      }

      send(req, res, 200, claim(config));
    } catch (err) {
      const status = err?.status || 500;
      send(req, res, status, { ok: false, error: status === 413 ? 'body_too_large' : 'internal_error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`linuxdo-invite listening on ${HOST}:${PORT}`);
  });
}
