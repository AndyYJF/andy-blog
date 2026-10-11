import crypto from 'node:crypto';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { appendAudit } from './audit-log.js';
import { CHALLENGE_TTL_SECONDS, CMS_ORIGIN, CMS_RP_ID } from './auth-bootstrap.js';

export const SESSION_SLIDING_SECONDS = 12 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;

function refused(status, error) {
  return { ok: false, status, error };
}

async function rollback(db) {
  try { await db.rollback(); } catch { /* already closed */ }
}

export function sessionCookie(token, maxAge = SESSION_SLIDING_SECONDS) {
  return `__Host-cms=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function beginAuthentication(db, { origin, now }) {
  const startedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  await db.beginTransaction();
  try {
    const [admins] = await db.query(
      'SELECT user_handle, user_name FROM cms_auth_admin WHERE id = 1 FOR UPDATE',
    );
    if (!admins.length) {
      await rollback(db);
      return refused(403, 'admin is not initialized');
    }
    const [creds] = await db.query(
      'SELECT credential_id, transports FROM cms_auth_credentials ORDER BY created_at, credential_id',
    );
    if (!creds.length) {
      await rollback(db);
      return refused(403, 'admin is not initialized');
    }
    const options = await generateAuthenticationOptions({
      rpID: CMS_RP_ID,
      userVerification: 'required',
      timeout: CHALLENGE_TTL_SECONDS * 1000,
      allowCredentials: creds.map((row) => ({
        id: row.credential_id,
        transports: row.transports ? String(row.transports).split(',') : undefined,
      })),
    });
    const admin = admins[0];
    await db.query(
      `INSERT INTO cms_auth_challenges
        (flow, challenge, origin, rp_id, user_handle, user_name, expires_at, created_at)
       VALUES ('authentication', ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.challenge,
        origin,
        CMS_RP_ID,
        admin.user_handle,
        admin.user_name,
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

export async function finishAuthentication(db, { origin, response, now }) {
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  await db.beginTransaction();
  try {
    const [challenges] = await db.query(
      `SELECT challenge_id, challenge
       FROM cms_auth_challenges
       WHERE flow = 'authentication' AND used_at IS NULL AND expires_at > ? AND origin = ? AND rp_id = ?
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
    const credentialId = response && typeof response.id === 'string' ? response.id : '';
    const [creds] = await db.query(
      `SELECT credential_id, public_key, counter
       FROM cms_auth_credentials WHERE credential_id = ? FOR UPDATE`,
      [credentialId],
    );
    let info = null;
    if (creds.length) {
      try {
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: CMS_ORIGIN,
          expectedRPID: CMS_RP_ID,
          requireUserVerification: true,
          credential: {
            id: creds[0].credential_id,
            publicKey: Uint8Array.from(creds[0].public_key),
            counter: Number(creds[0].counter),
          },
        });
        if (result.verified) info = result.authenticationInfo;
      } catch {
        info = null;
      }
    }
    await db.query(
      'UPDATE cms_auth_challenges SET used_at = ? WHERE challenge_id = ? AND used_at IS NULL',
      [finishedAt, challenge.challenge_id],
    );
    if (!info) {
      await db.commit();
      return refused(400, 'authentication refused');
    }
    const storedCounter = Number(creds[0].counter);
    if (!(info.newCounter === 0 && storedCounter === 0)) {
      const [updated] = await db.query(
        `UPDATE cms_auth_credentials SET counter = ?
         WHERE credential_id = ? AND counter < ?`,
        [info.newCounter, creds[0].credential_id, info.newCounter],
      );
      if (updated.affectedRows !== 1) {
        await db.commit();
        return refused(400, 'authentication refused');
      }
    }
    await db.query(
      'UPDATE cms_auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL',
      [finishedAt],
    );
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    const csrfHash = crypto.createHash('sha256').update(csrfToken, 'utf8').digest('hex');
    await db.query(
      `INSERT INTO cms_auth_sessions
        (token_hash, credential_id, created_at, absolute_until, idle_until, csrf_hash, reauth_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tokenHash,
        creds[0].credential_id,
        finishedAt,
        finishedAt + SESSION_ABSOLUTE_SECONDS,
        finishedAt + SESSION_SLIDING_SECONDS,
        csrfHash,
        finishedAt,
      ],
    );
    await appendAudit(db, {
      action: 'auth.login',
      detail: { credentialId: creds[0].credential_id },
      now: finishedAt,
    });
    await db.commit();
    return { ok: true, cookie: sessionCookie(token), csrfToken, credentialId: creds[0].credential_id };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}
