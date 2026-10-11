import crypto from 'node:crypto';
import { SESSION_SLIDING_SECONDS } from './auth-login.js';

const WRITE = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const EXEMPT = new Set(['/api/preview', '/api/auth/login', '/api/auth/register', '/api/auth/recover']);
const PASSKEY = new Set(['/api/auth/reauth', '/api/auth/credentials', '/api/auth/totp']);

export function authWriteGate(method, pathname) {
  if (!WRITE.has(method) || EXEMPT.has(pathname)) return 'none';
  if (pathname === '/api/auth/logout') return 'logout';
  if (PASSKEY.has(pathname)) return 'passkey';
  return 'write';
}

export function writeNeedsSession(method, pathname) {
  return authWriteGate(method, pathname) === 'write';
}

export function sessionTokenFromCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  for (const part of cookieHeader.split(';')) {
    const text = part.trim();
    const eq = text.indexOf('=');
    if (eq <= 0) continue;
    if (text.slice(0, eq) === '__Host-cms') return text.slice(eq + 1);
  }
  return null;
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

async function loadLiveSession(db, { cookie, csrf, now }) {
  const token = sessionTokenFromCookie(cookie);
  if (!token) return { ok: false, status: 401, error: 'session required' };
  const [rows] = await db.query(
    `SELECT token_hash, csrf_hash, idle_until, absolute_until, revoked_at, purpose, reauth_at
     FROM cms_auth_sessions WHERE token_hash = ?`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row || row.revoked_at != null) return { ok: false, status: 401, error: 'session required' };
  if (Number(row.absolute_until) <= now || Number(row.idle_until) <= now) {
    return { ok: false, status: 401, error: 'session expired' };
  }
  const presented = typeof csrf === 'string' ? csrf : '';
  if (!presented || !sameHash(tokenHash(presented), row.csrf_hash)) {
    return { ok: false, status: 403, error: 'csrf refused' };
  }
  return { ok: true, row };
}

async function slideSession(db, row, now) {
  const idle = Math.min(now + SESSION_SLIDING_SECONDS, Number(row.absolute_until));
  await db.query(
    'UPDATE cms_auth_sessions SET idle_until = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [idle, row.token_hash],
  );
}

export async function authorizeWrite(db, { cookie, csrf, now }) {
  const loaded = await loadLiveSession(db, { cookie, csrf, now });
  if (!loaded.ok) return loaded;
  if (loaded.row.purpose === 'rebind') return { ok: false, status: 403, error: 'rebind session cannot write' };
  await slideSession(db, loaded.row, now);
  return { ok: true, tokenHash: loaded.row.token_hash };
}

export async function authorizePasskeyChange(db, { cookie, csrf, now, reauthSeconds }) {
  const loaded = await loadLiveSession(db, { cookie, csrf, now });
  if (!loaded.ok) return loaded;
  if (loaded.row.purpose !== 'rebind') {
    if (loaded.row.reauth_at == null || Number(loaded.row.reauth_at) + reauthSeconds < now) {
      return { ok: false, status: 403, error: 'recent authentication required' };
    }
  }
  await slideSession(db, loaded.row, now);
  return { ok: true, tokenHash: loaded.row.token_hash, purpose: loaded.row.purpose };
}

export async function authorizeSession(db, { cookie, csrf, now }) {
  const loaded = await loadLiveSession(db, { cookie, csrf, now });
  if (!loaded.ok) return loaded;
  return { ok: true };
}

export async function logoutSession(db, { cookie, csrf, now }) {
  const loaded = await loadLiveSession(db, { cookie, csrf, now });
  if (!loaded.ok) return loaded;
  await db.query(
    'UPDATE cms_auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [now, loaded.row.token_hash],
  );
  return { ok: true };
}

export async function revokeSession(db, { cookie, csrf, now }) {
  const decision = await authorizeWrite(db, { cookie, csrf, now });
  if (!decision.ok) return decision;
  await db.query(
    'UPDATE cms_auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [now, decision.tokenHash],
  );
  return { ok: true };
}
