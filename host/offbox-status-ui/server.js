import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const EX_CONFIG = 65;
const SECRET_LINE = /(password|secret|private[ _-]?key|begin openssh|token=|authorization:)/i;
const STEP_STATES = new Set(['pending', 'running', 'done', 'failed']);
const STATUSES = new Set(['idle', 'queued', 'running', 'success', 'failed']);
const COOKIE_NAME = 'offbox_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/app.css']);
const BODY_LIMIT = 4096;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_LOCKOUT_MS = 120_000;
const LOGIN_PRUNE_EVERY_MS = 60_000;

/** @type {Map<string, { failures: number[], lockedUntil: number }>} */
const loginAttempts = new Map();
let lastLoginPruneAt = 0;

function envRuntime() {
  return process.env.OFFBOX_STATUS_RUNTIME || '/opt/andy-blog-offbox/runtime';
}

function envBind() {
  return process.env.OFFBOX_STATUS_BIND || '127.0.0.1';
}

function envPort() {
  return Number(process.env.OFFBOX_STATUS_PORT || 8787);
}

function isLoopbackBind(bind) {
  return bind === '127.0.0.1' || bind === '::1';
}

function firstLine(text) {
  return String(text ?? '')
    .split(/\r?\n/, 1)[0]
    .trim();
}

function loadPassword() {
  const file = process.env.STATUS_UI_PASSWORD_FILE;
  if (!file) return '';
  try {
    return firstLine(fs.readFileSync(file, 'utf8'));
  } catch {
    return '';
  }
}

function authConfigured() {
  return Boolean(loadPassword());
}

function sha256buf(value) {
  return crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest();
}

function timingSafeEqualString(a, b) {
  return crypto.timingSafeEqual(sha256buf(a), sha256buf(b));
}

function sessionSecret() {
  return sha256buf(`${loadPassword()}|offbox-status-ui`);
}

function signSession() {
  const exp = String(Date.now() + SESSION_MS);
  const sig = crypto.createHmac('sha256', sessionSecret()).update(exp).digest('base64url');
  return `${exp}.${sig}`;
}

function sessionValid(token) {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (dot < 1) return false;
  const exp = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!exp || !sig) return false;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(exp).digest('base64url');
  if (!timingSafeEqualString(sig, expected)) return false;
  const expMs = Number(exp);
  return Number.isFinite(expMs) && Date.now() < expMs;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function cookieHeader(token, maxAge = Math.floor(SESSION_MS / 1000)) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  return parts.join('; ');
}

function allowNoAuth() {
  return process.env.ALLOW_NO_AUTH === '1';
}

function authorized(req) {
  // Escape hatch: ALLOW_NO_AUTH=1 with no password treats all requests as authorized.
  if (!authConfigured()) return allowNoAuth();
  return sessionValid(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

/** Client IP: behind loopback+Caddy, prefer X-Forwarded-For / X-Real-IP; else socket. */
export function clientIp(req) {
  if (isLoopbackBind(envBind())) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = String(Array.isArray(xff) ? xff[0] : xff)
        .split(',')[0]
        .trim();
      if (first) return first;
    }
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      const value = String(Array.isArray(realIp) ? realIp[0] : realIp).trim();
      if (value) return value;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [ip, entry] of loginAttempts) {
    if (entry.lockedUntil > now) continue;
    entry.failures = entry.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
    if (entry.lockedUntil <= now) entry.lockedUntil = 0;
    if (entry.lockedUntil === 0 && entry.failures.length === 0) {
      loginAttempts.delete(ip);
    }
  }
}

function maybePruneLoginAttempts(now = Date.now()) {
  if (now - lastLoginPruneAt < LOGIN_PRUNE_EVERY_MS) return;
  lastLoginPruneAt = now;
  pruneLoginAttempts(now);
}

function isLoginRateLimited(ip) {
  const now = Date.now();
  maybePruneLoginAttempts(now);
  const entry = loginAttempts.get(ip);
  return Boolean(entry && entry.lockedUntil > now);
}

function recordLoginFailure(ip) {
  const now = Date.now();
  maybePruneLoginAttempts(now);
  let entry = loginAttempts.get(ip);
  if (!entry) {
    entry = { failures: [], lockedUntil: 0 };
    loginAttempts.set(ip, entry);
  }
  if (entry.lockedUntil > now) return;
  entry.failures = entry.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= LOGIN_MAX_FAILURES) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    entry.failures = [];
  }
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

/** Test-only: clear in-process login rate-limit state. */
export function resetLoginRateLimitsForTests() {
  loginAttempts.clear();
  lastLoginPruneAt = 0;
}

function sendAuthNotConfigured(res) {
  sendJson(res, 503, { error: 'auth_not_configured' });
}

function denyUnauthenticated(res) {
  if (!authConfigured()) {
    sendAuthNotConfigured(res);
    return;
  }
  sendUnauthorized(res);
}

export function sanitizeLine(line) {
  const text = String(line ?? '')
    .replace(/\s+$/u, '')
    .slice(0, 500);
  if (!text) return '';
  if (SECRET_LINE.test(text)) return '[redacted]';
  return text;
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readLogTail(file, limit = 80) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return text.split(/\r?\n/).map(sanitizeLine).filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

function publicSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 16).map((step) => ({
    id: String(step?.id || '').slice(0, 40),
    label: String(step?.label || '').slice(0, 80),
    state: STEP_STATES.has(step?.state) ? step.state : 'pending',
  }));
}

function clip(value, max = 40) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function publicOutcome(value) {
  if (!value || typeof value !== 'object') return null;
  const status = value.status === 'success' || value.status === 'failed' ? value.status : null;
  if (!status) return null;
  return {
    status,
    finishedAt: clip(value.finishedAt, 40),
    startedAt: clip(value.startedAt, 40),
    releaseId: clip(value.releaseId),
    phase: clip(value.phase),
    error: value.error == null ? null : sanitizeLine(value.error),
    retryCount: Number.isFinite(Number(value.retryCount)) ? Number(value.retryCount) : 0,
    retryMax: Number.isFinite(Number(value.retryMax)) ? Number(value.retryMax) : 3,
    retryExhausted: Boolean(value.retryExhausted),
    builder: clip(value.builder, 32),
  };
}

export async function readHistory(runtimeDir = envRuntime(), limit = 100) {
  const file = path.join(path.resolve(runtimeDir), 'history.jsonl');
  let text = '';
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const parsed = publicOutcome(JSON.parse(line));
      if (parsed) items.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return items.slice(-limit).reverse();
}

export async function readStatus(runtimeDir = envRuntime()) {
  const runtime = path.resolve(runtimeDir);
  const paths = {
    pending: path.join(runtime, 'pending'),
    dirty: path.join(runtime, 'dirty'),
    building: path.join(runtime, 'building'),
    progress: path.join(runtime, 'progress.json'),
    progressLog: path.join(runtime, 'progress.log'),
    lastFailure: path.join(runtime, 'last-failure.json'),
  };
  const [pending, dirty, building] = await Promise.all([
    exists(paths.pending),
    exists(paths.dirty),
    exists(paths.building),
  ]);
  const progress = (await readJsonFile(paths.progress, {})) || {};
  const failure = await readJsonFile(paths.lastFailure, null);
  const tail = await readLogTail(paths.progressLog, 80);
  let status = STATUSES.has(progress.status) ? progress.status : 'idle';
  if (building) status = 'running';
  else if (pending || dirty) {
    status = status === 'failed' ? 'queued' : status === 'running' ? 'running' : 'queued';
  }
  return {
    status,
    phase: String(progress.phase || (status === 'queued' ? 'queued' : 'idle')).slice(0, 40),
    builder: clip(progress.builder, 32),
    releaseId: clip(progress.releaseId),
    current: clip(progress.current),
    previous: clip(progress.previous),
    startedAt: clip(progress.startedAt),
    updatedAt: clip(progress.updatedAt),
    error: progress.error == null ? null : sanitizeLine(progress.error),
    steps: publicSteps(progress.steps),
    dirty,
    queued: pending || dirty,
    building,
    lastFailure:
      failure && typeof failure === 'object'
        ? {
            failedAt: clip(failure.failedAt),
            rc: Number.isFinite(Number(failure.rc)) ? Number(failure.rc) : null,
            phase: clip(failure.phase),
          }
        : null,
    lastOutcome: publicOutcome(progress.lastOutcome) || (await readHistory(runtime, 1))[0] || null,
    retryCount: Number.isFinite(Number(progress.retryCount)) ? Number(progress.retryCount) : 0,
    retryMax: Number.isFinite(Number(progress.retryMax)) ? Number(progress.retryMax) : 3,
    retryExhausted: Boolean(progress.retryExhausted),
    tail,
  };
}

function requestPathname(req) {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch {
    return '/';
  }
}

function isInsidePublic(target) {
  const rel = path.relative(PUBLIC_DIR, path.resolve(target));
  return rel === '' || (Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolvePublicFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!isInsidePublic(target)) return null;
  if (target === PUBLIC_DIR) return path.join(PUBLIC_DIR, 'index.html');
  return target;
}

function mimeType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sendUnauthorized(res) {
  sendJson(res, 401, { error: 'unauthorized' });
}

function sendRateLimited(res) {
  sendJson(res, 429, { error: 'rate_limited' });
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parsePassword(req, raw) {
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try {
      const body = JSON.parse(raw || '{}');
      return firstLine(body?.password);
    } catch {
      return '';
    }
  }
  return firstLine(new URLSearchParams(raw).get('password'));
}

function isFormLogin(req) {
  return String(req.headers['content-type'] || '').includes(
    'application/x-www-form-urlencoded',
  );
}

async function serveStatic(res, urlPath) {
  const file = resolvePublicFile(urlPath);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  let st;
  try {
    st = await fsp.stat(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404).end();
    return;
  }
  const body = await fsp.readFile(file);
  res.writeHead(200, { 'content-type': mimeType(file) });
  res.end(body);
}

function clearSession(res, location = '/') {
  res.writeHead(303, {
    location,
    'set-cookie': cookieHeader('', 0),
  });
  res.end();
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = requestPathname(req);
      if (req.method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && pathname === '/logout') {
        clearSession(res, '/');
        return;
      }
      if (req.method === 'POST' && pathname === '/login') {
        const ip = clientIp(req);
        if (isLoginRateLimited(ip)) {
          console.warn(`login rate_limited ip=${ip} at=${new Date().toISOString()}`);
          sendRateLimited(res);
          return;
        }
        const expected = loadPassword();
        let raw = '';
        try {
          raw = await readBody(req);
        } catch {
          sendJson(res, 413, { error: 'error' });
          return;
        }
        const password = parsePassword(req, raw);
        const ok = Boolean(expected) && timingSafeEqualString(password, expected);
        if (!ok) {
          recordLoginFailure(ip);
          console.warn(`login failed ip=${ip} at=${new Date().toISOString()}`);
          if (isLoginRateLimited(ip)) {
            sendRateLimited(res);
            return;
          }
          if (isFormLogin(req)) {
            res.writeHead(303, { location: '/?e=1' });
            res.end();
            return;
          }
          sendUnauthorized(res);
          return;
        }
        clearLoginFailures(ip);
        if (isFormLogin(req)) {
          res.writeHead(303, {
            location: '/',
            'set-cookie': cookieHeader(signSession()),
          });
          res.end();
          return;
        }
        res.writeHead(204, { 'set-cookie': cookieHeader(signSession()) });
        res.end();
        return;
      }
      if (req.method === 'GET' && PUBLIC_PATHS.has(pathname)) {
        await serveStatic(res, pathname);
        return;
      }
      if (req.method === 'GET' && (pathname === '/' || pathname === '/history') && !authorized(req)) {
        if (!authConfigured()) {
          denyUnauthenticated(res);
          return;
        }
        await serveStatic(res, '/login.html');
        return;
      }
      if (!authorized(req)) {
        denyUnauthenticated(res);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/status') {
        const body = await readStatus();
        sendJson(res, 200, body, { 'cache-control': 'no-store' });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/history') {
        const items = await readHistory();
        sendJson(res, 200, { items }, { 'cache-control': 'no-store' });
        return;
      }
      if (req.method === 'GET' && pathname === '/history') {
        await serveStatic(res, '/history.html');
        return;
      }
      if (req.method === 'GET') {
        await serveStatic(res, pathname);
        return;
      }
      res.writeHead(404).end();
    } catch {
      sendJson(res, 500, { error: 'error' });
    }
  });
}

function assertBindAuth() {
  // ALLOW_NO_AUTH=1 is an explicit escape hatch for local/dev; loopback does not skip password.
  if (allowNoAuth()) return;
  if (!authConfigured()) {
    console.error(
      'STATUS_UI_PASSWORD_FILE must point to a non-empty password (set ALLOW_NO_AUTH=1 to bypass)',
    );
    process.exit(EX_CONFIG);
  }
}

async function main() {
  assertBindAuth();
  const bind = envBind();
  const port = envPort();
  const server = createServer();
  server.listen(port, bind, () => {
    console.error(`offbox-status-ui listening on ${bind}:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
