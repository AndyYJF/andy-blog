import crypto from 'node:crypto';
import { appendAudit } from './audit-log.js';
import { hashBootstrapSecret } from './auth-bootstrap.js';
import { sessionCookie } from './auth-login.js';
import { authorizePasskeyChange } from './auth-session.js';

export const TOTP_STEP_SECONDS = 30;
export const REBIND_SECONDS = 10 * 60;
export const RECOVERY_FAILURE_LIMIT = 5;
export const RECOVERY_FAILURE_WINDOW = 10 * 60;
const REAUTH_SECONDS = 5 * 60;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function refused(status, error) {
  return { ok: false, status, error };
}

async function rollback(db) {
  try { await db.rollback(); } catch { /* already closed */ }
}

export function base32Encode(bytes) {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export function totpAt(secret, now) {
  return hotp(secret, Math.floor(now / TOTP_STEP_SECONDS));
}

function matchingStep(secret, code, now) {
  const current = Math.floor(now / TOTP_STEP_SECONDS);
  for (const step of [current + 1, current, current - 1]) {
    if (step >= 0 && hotp(secret, step) === code) return step;
  }
  return null;
}

export function encryptTotpSecret(secret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptTotpSecret(packed, key) {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const body = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) return refused(400, 'totp key must be 32 bytes');
  return null;
}

function codeHash(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

async function noteFailure(db, row, now) {
  const resetAt = Number(row.failures_reset_at);
  const failures = now >= resetAt ? 1 : Number(row.failures) + 1;
  const nextReset = now >= resetAt ? now + RECOVERY_FAILURE_WINDOW : resetAt;
  await db.query(
    'UPDATE cms_auth_totp SET failures = ?, failures_reset_at = ? WHERE id = 1',
    [failures, nextReset],
  );
}

export async function enableTotp(db, { cookie, csrf, now, key }) {
  const badKey = requireKey(key);
  if (badKey) return badKey;
  const startedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  const decision = await authorizePasskeyChange(db, {
    cookie, csrf, now: startedAt, reauthSeconds: REAUTH_SECONDS,
  });
  if (!decision.ok) return decision;
  const [existing] = await db.query('SELECT id FROM cms_auth_totp WHERE id = 1');
  if (existing.length) return refused(409, 'totp already enabled');
  const secret = crypto.randomBytes(20);
  const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(8).toString('hex'));
  await db.beginTransaction();
  try {
    await db.query(
      `INSERT INTO cms_auth_totp
        (id, secret_enc, last_step, enabled_at, failures, failures_reset_at)
       VALUES (1, ?, NULL, ?, 0, ?)`,
      [encryptTotpSecret(secret, key), startedAt, startedAt],
    );
    for (const code of recoveryCodes) {
      await db.query(
        'INSERT INTO cms_auth_recovery_codes (code_hash) VALUES (?)',
        [codeHash(code)],
      );
    }
    await appendAudit(db, { action: 'auth.totp.enable', detail: {}, now: startedAt });
    await db.commit();
  } catch (error) {
    await rollback(db);
    throw error;
  }
  return { ok: true, secret: base32Encode(secret), recoveryCodes };
}

async function issueRebindSession(db, now) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const csrfHash = crypto.createHash('sha256').update(csrfToken, 'utf8').digest('hex');
  const [creds] = await db.query(
    'SELECT credential_id FROM cms_auth_credentials ORDER BY created_at LIMIT 1',
  );
  const credentialId = creds.length ? creds[0].credential_id : '';
  await db.query(
    'UPDATE cms_auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL',
    [now],
  );
  await db.query(
    `INSERT INTO cms_auth_sessions
      (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at, purpose)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'rebind')`,
    [tokenHash, credentialId, now, now + REBIND_SECONDS, now + REBIND_SECONDS, csrfHash, now],
  );
  return { cookie: sessionCookie(token, REBIND_SECONDS), csrfToken };
}

export async function recoverAccess(db, { code, recoveryCode, now, key }) {
  const badKey = requireKey(key);
  if (badKey) return badKey;
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [rows] = await db.query('SELECT * FROM cms_auth_totp WHERE id = 1 FOR UPDATE');
    if (!rows.length) {
      await rollback(db);
      return refused(403, 'recovery refused');
    }
    const row = rows[0];
    if (Number(row.failures) >= RECOVERY_FAILURE_LIMIT && finishedAt < Number(row.failures_reset_at)) {
      await db.commit();
      return refused(429, 'recovery rate limit exceeded');
    }
    let secret;
    try {
      secret = decryptTotpSecret(row.secret_enc, key);
    } catch {
      await noteFailure(db, row, finishedAt);
      await db.commit();
      return refused(403, 'recovery refused');
    }
    const step = matchingStep(secret, String(code || ''), finishedAt);
    const replay = step != null && row.last_step != null && step <= Number(row.last_step);
    const [codes] = await db.query(
      'SELECT code_hash, used_at FROM cms_auth_recovery_codes WHERE code_hash = ? FOR UPDATE',
      [codeHash(recoveryCode || '')],
    );
    const codeOk = codes.length === 1 && codes[0].used_at == null;
    if (step == null || replay || !codeOk) {
      await noteFailure(db, row, finishedAt);
      await db.commit();
      return refused(403, 'recovery refused');
    }
    const [used] = await db.query(
      'UPDATE cms_auth_recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL',
      [finishedAt, codes[0].code_hash],
    );
    if (used.affectedRows !== 1) {
      await noteFailure(db, row, finishedAt);
      await db.commit();
      return refused(403, 'recovery refused');
    }
    await db.query(
      'UPDATE cms_auth_totp SET last_step = ?, failures = 0, failures_reset_at = ? WHERE id = 1',
      [step, finishedAt],
    );
    const session = await issueRebindSession(db, finishedAt);
    await appendAudit(db, { action: 'auth.recover', detail: {}, now: finishedAt });
    await db.commit();
    return { ok: true, ...session };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}

export async function issueOfflineRebind(db, { now, ttlSeconds = 15 * 60, replace = false } = {}) {
  const issuedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  const secret = crypto.randomBytes(32).toString('hex');
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      'SELECT expires_at, uses_remaining FROM cms_auth_offline_rebind WHERE id = 1 FOR UPDATE',
    );
    const current = rows[0];
    if (current && Number(current.uses_remaining) > 0 && Number(current.expires_at) > issuedAt && !replace) {
      await rollback(db);
      return refused(65, 'unused offline rebind secret still valid');
    }
    await db.query(
      `INSERT INTO cms_auth_offline_rebind
        (id, secret_hash, expires_at, uses_remaining, created_at)
       VALUES (1, ?, ?, 1, ?) AS new
       ON DUPLICATE KEY UPDATE
         secret_hash = new.secret_hash,
         expires_at = new.expires_at,
         uses_remaining = new.uses_remaining,
         created_at = new.created_at`,
      [hashBootstrapSecret(secret), issuedAt + ttlSeconds, issuedAt],
    );
    await db.commit();
    return { ok: true, secret };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}

export async function consumeOfflineRebind(db, { secret, now }) {
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (typeof secret !== 'string' || secret.length === 0) return refused(403, 'offline rebind refused');
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      'SELECT secret_hash, expires_at, uses_remaining FROM cms_auth_offline_rebind WHERE id = 1 FOR UPDATE',
    );
    const row = rows[0];
    if (!row || row.secret_hash !== hashBootstrapSecret(secret) || Number(row.uses_remaining) < 1 || Number(row.expires_at) <= finishedAt) {
      await rollback(db);
      return refused(403, 'offline rebind refused');
    }
    await db.query('UPDATE cms_auth_offline_rebind SET uses_remaining = 0 WHERE id = 1');
    const session = await issueRebindSession(db, finishedAt);
    await appendAudit(db, { action: 'auth.offline-rebind', detail: {}, now: finishedAt });
    await db.commit();
    return { ok: true, ...session };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}
