import crypto from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { appendAudit } from './audit-log.js';

export const CMS_ORIGIN = 'http://127.0.0.1:4322';
export const CMS_RP_ID = '127.0.0.1';
export const CMS_RP_NAME = 'andy-blog CMS';
export const BOOTSTRAP_TTL_SECONDS = 15 * 60;
export const CHALLENGE_TTL_SECONDS = 60;

export function hashBootstrapSecret(secret) {
  return crypto.createHash('sha256').update(Buffer.from(String(secret), 'utf8')).digest('hex');
}

function refused(status, error) {
  return { ok: false, status, error };
}

async function rollback(db) {
  try { await db.rollback(); } catch { /* already closed */ }
}

export async function issueBootstrap(db, { now, ttlSeconds = BOOTSTRAP_TTL_SECONDS, replace = false } = {}) {
  const issuedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  const secret = crypto.randomBytes(32).toString('hex');
  const hash = hashBootstrapSecret(secret);
  await db.beginTransaction();
  try {
    const [admins] = await db.query('SELECT id FROM cms_auth_admin WHERE id = 1 FOR UPDATE');
    if (admins.length) {
      await rollback(db);
      return refused(65, 'admin already initialized');
    }
    const [rows] = await db.query(
      'SELECT expires_at, uses_remaining FROM cms_auth_bootstrap WHERE id = 1 FOR UPDATE',
    );
    const current = rows[0];
    if (current && Number(current.uses_remaining) > 0 && Number(current.expires_at) > issuedAt && !replace) {
      await rollback(db);
      return refused(65, 'unused bootstrap secret still valid');
    }
    await db.query(
      `INSERT INTO cms_auth_bootstrap (id, secret_hash, expires_at, uses_remaining, created_at)
       VALUES (1, ?, ?, 1, ?) AS new
       ON DUPLICATE KEY UPDATE
         secret_hash = new.secret_hash,
         expires_at = new.expires_at,
         uses_remaining = new.uses_remaining,
         created_at = new.created_at`,
      [hash, issuedAt + ttlSeconds, issuedAt],
    );
    await db.commit();
    return { ok: true, secret, expiresAt: issuedAt + ttlSeconds };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}

async function lockUnusedSecret(db, secret, now) {
  const [admins] = await db.query('SELECT id FROM cms_auth_admin WHERE id = 1 FOR UPDATE');
  if (admins.length) return refused(403, 'admin already initialized');
  const [rows] = await db.query(
    'SELECT secret_hash, expires_at, uses_remaining FROM cms_auth_bootstrap WHERE id = 1 FOR UPDATE',
  );
  const row = rows[0];
  const hash = hashBootstrapSecret(secret);
  if (!row || row.secret_hash !== hash || Number(row.uses_remaining) < 1 || Number(row.expires_at) <= now) {
    return refused(403, 'bootstrap secret refused');
  }
  return null;
}

export async function beginRegistration(db, { secret, origin, now, userName = 'admin' }) {
  const startedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  if (typeof secret !== 'string' || secret.length === 0) return refused(403, 'bootstrap secret required');
  await db.beginTransaction();
  try {
    const blocked = await lockUnusedSecret(db, secret, startedAt);
    if (blocked) {
      await rollback(db);
      return blocked;
    }
    const userHandle = crypto.randomBytes(32);
    const options = await generateRegistrationOptions({
      rpName: CMS_RP_NAME,
      rpID: CMS_RP_ID,
      userName,
      userID: userHandle,
      userDisplayName: userName,
      timeout: CHALLENGE_TTL_SECONDS * 1000,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });
    await db.query(
      `INSERT INTO cms_auth_challenges
        (flow, challenge, origin, rp_id, user_handle, user_name, expires_at, created_at)
       VALUES ('registration', ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.challenge,
        origin,
        CMS_RP_ID,
        Buffer.from(userHandle).toString('base64url'),
        userName,
        startedAt + CHALLENGE_TTL_SECONDS,
        startedAt,
      ],
    );
    await db.commit();
    return { ok: true, options };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}

export async function finishRegistration(db, { secret, origin, response, now }) {
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  if (typeof secret !== 'string' || secret.length === 0) return refused(403, 'bootstrap secret required');
  await db.beginTransaction();
  try {
    const blocked = await lockUnusedSecret(db, secret, finishedAt);
    if (blocked) {
      await rollback(db);
      return blocked;
    }
    const [challenges] = await db.query(
      `SELECT challenge_id, challenge, user_handle, user_name
       FROM cms_auth_challenges
       WHERE flow = 'registration' AND used_at IS NULL AND expires_at > ? AND origin = ? AND rp_id = ?
       ORDER BY challenge_id DESC
       LIMIT 1
       FOR UPDATE`,
      [finishedAt, origin, CMS_RP_ID],
    );
    if (!challenges.length) {
      await rollback(db);
      return refused(400, 'challenge expired');
    }
    const challenge = challenges[0];
    let info = null;
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: CMS_ORIGIN,
        expectedRPID: CMS_RP_ID,
        requireUserVerification: true,
      });
      if (result.verified) info = result.registrationInfo;
    } catch {
      info = null;
    }
    await db.query(
      'UPDATE cms_auth_challenges SET used_at = ? WHERE challenge_id = ? AND used_at IS NULL',
      [finishedAt, challenge.challenge_id],
    );
    if (!info) {
      await db.commit();
      return refused(400, 'registration refused');
    }
    const credential = info.credential;
    await db.query(
      `INSERT INTO cms_auth_admin (id, user_handle, user_name, created_at) VALUES (1, ?, ?, ?)`,
      [challenge.user_handle, challenge.user_name, finishedAt],
    );
    await db.query(
      `INSERT INTO cms_auth_credentials
        (credential_id, public_key, counter, transports, aaguid, fmt, device_type, backed_up,
         user_verified, user_handle, user_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports?.length ? credential.transports.join(',') : null,
        info.aaguid,
        info.fmt,
        info.credentialDeviceType,
        info.credentialBackedUp ? 1 : 0,
        info.userVerified ? 1 : 0,
        challenge.user_handle,
        challenge.user_name,
        finishedAt,
      ],
    );
    await db.query('UPDATE cms_auth_bootstrap SET uses_remaining = 0 WHERE id = 1');
    await appendAudit(db, {
      action: 'auth.register',
      detail: { credentialId: credential.id },
      now: finishedAt,
    });
    await db.commit();
    return { ok: true, credentialId: credential.id };
  } catch (error) {
    await rollback(db);
    if (error && error.code === 'ER_DUP_ENTRY') return refused(403, 'admin already initialized');
    throw error;
  }
}
