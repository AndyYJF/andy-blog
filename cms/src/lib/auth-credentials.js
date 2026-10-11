import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { appendAudit } from './audit-log.js';
import { CHALLENGE_TTL_SECONDS, CMS_ORIGIN, CMS_RP_ID, CMS_RP_NAME } from './auth-bootstrap.js';
import { authorizePasskeyChange, authorizeWrite } from './auth-session.js';

export const REAUTH_SECONDS = 5 * 60;

function refused(status, error) {
  return { ok: false, status, error };
}

async function rollback(db) {
  try { await db.rollback(); } catch { /* already closed */ }
}

async function openRecentSession(db, { cookie, csrf, now }) {
  return authorizePasskeyChange(db, { cookie, csrf, now, reauthSeconds: REAUTH_SECONDS });
}

async function storedCredentials(db) {
  const [creds] = await db.query(
    'SELECT credential_id, transports, public_key, counter FROM cms_auth_credentials ORDER BY created_at, credential_id',
  );
  return creds;
}

export async function beginReauth(db, { origin, cookie, csrf, now }) {
  const startedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  const decision = await authorizeWrite(db, { cookie, csrf, now: startedAt });
  if (!decision.ok) return decision;
  const creds = await storedCredentials(db);
  if (!creds.length) return refused(403, 'admin is not initialized');
  const [admins] = await db.query('SELECT user_handle, user_name FROM cms_auth_admin WHERE id = 1');
  if (!admins.length) return refused(403, 'admin is not initialized');
  const options = await generateAuthenticationOptions({
    rpID: CMS_RP_ID,
    userVerification: 'required',
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    allowCredentials: creds.map((row) => ({
      id: row.credential_id,
      transports: row.transports ? String(row.transports).split(',') : undefined,
    })),
  });
  await db.query(
    `INSERT INTO cms_auth_challenges
      (flow, challenge, origin, rp_id, user_handle, user_name, expires_at, created_at)
     VALUES ('reauth', ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.challenge,
      origin,
      CMS_RP_ID,
      admins[0].user_handle,
      admins[0].user_name,
      startedAt + CHALLENGE_TTL_SECONDS,
      startedAt,
    ],
  );
  return { ok: true, options };
}

export async function finishReauth(db, { origin, cookie, csrf, response, now }) {
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  const decision = await authorizeWrite(db, { cookie, csrf, now: finishedAt });
  if (!decision.ok) return decision;
  await db.beginTransaction();
  try {
    const [challenges] = await db.query(
      `SELECT challenge_id, challenge
       FROM cms_auth_challenges
       WHERE flow = 'reauth' AND used_at IS NULL AND expires_at > ? AND origin = ? AND rp_id = ?
       ORDER BY challenge_id DESC LIMIT 1 FOR UPDATE`,
      [finishedAt, origin, CMS_RP_ID],
    );
    if (!challenges.length) {
      await rollback(db);
      return refused(400, 'challenge expired');
    }
    const credentialId = response && typeof response.id === 'string' ? response.id : '';
    const [creds] = await db.query(
      'SELECT credential_id, public_key, counter FROM cms_auth_credentials WHERE credential_id = ? FOR UPDATE',
      [credentialId],
    );
    let info = null;
    if (creds.length) {
      try {
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenges[0].challenge,
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
      [finishedAt, challenges[0].challenge_id],
    );
    if (!info) {
      await db.commit();
      return refused(400, 'authentication refused');
    }
    const storedCounter = Number(creds[0].counter);
    if (!(info.newCounter === 0 && storedCounter === 0)) {
      const [updated] = await db.query(
        'UPDATE cms_auth_credentials SET counter = ? WHERE credential_id = ? AND counter < ?',
        [info.newCounter, creds[0].credential_id, info.newCounter],
      );
      if (updated.affectedRows !== 1) {
        await db.commit();
        return refused(400, 'authentication refused');
      }
    }
    const [marked] = await db.query(
      'UPDATE cms_auth_sessions SET reauth_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      [finishedAt, decision.tokenHash],
    );
    if (marked.affectedRows !== 1) {
      await db.commit();
      return refused(401, 'session required');
    }
    await appendAudit(db, {
      action: 'auth.reauth',
      detail: { credentialId: creds[0].credential_id },
      now: finishedAt,
    });
    await db.commit();
    return { ok: true };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}

export async function beginCredential(db, { origin, cookie, csrf, now }) {
  const startedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  const decision = await openRecentSession(db, { cookie, csrf, now: startedAt });
  if (!decision.ok) return decision;
  const [admins] = await db.query('SELECT user_handle, user_name FROM cms_auth_admin WHERE id = 1');
  if (!admins.length) return refused(403, 'admin is not initialized');
  const creds = await storedCredentials(db);
  const userHandle = Buffer.from(admins[0].user_handle, 'base64url');
  const options = await generateRegistrationOptions({
    rpName: CMS_RP_NAME,
    rpID: CMS_RP_ID,
    userName: admins[0].user_name,
    userID: userHandle,
    userDisplayName: admins[0].user_name,
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    attestationType: 'none',
    excludeCredentials: creds.map((row) => ({
      id: row.credential_id,
      transports: row.transports ? String(row.transports).split(',') : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  await db.query(
    `INSERT INTO cms_auth_challenges
      (flow, challenge, origin, rp_id, user_handle, user_name, expires_at, created_at)
     VALUES ('credential', ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.challenge,
      origin,
      CMS_RP_ID,
      admins[0].user_handle,
      admins[0].user_name,
      startedAt + CHALLENGE_TTL_SECONDS,
      startedAt,
    ],
  );
  return { ok: true, options };
}

export async function finishCredential(db, { origin, cookie, csrf, response, now }) {
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  if (origin !== CMS_ORIGIN) return refused(403, 'origin refused');
  const decision = await openRecentSession(db, { cookie, csrf, now: finishedAt });
  if (!decision.ok) return decision;
  await db.beginTransaction();
  try {
    const [challenges] = await db.query(
      `SELECT challenge_id, challenge, user_handle, user_name
       FROM cms_auth_challenges
       WHERE flow = 'credential' AND used_at IS NULL AND expires_at > ? AND origin = ? AND rp_id = ?
       ORDER BY challenge_id DESC LIMIT 1 FOR UPDATE`,
      [finishedAt, origin, CMS_RP_ID],
    );
    if (!challenges.length) {
      await rollback(db);
      return refused(400, 'challenge expired');
    }
    let info = null;
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenges[0].challenge,
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
      [finishedAt, challenges[0].challenge_id],
    );
    if (!info) {
      await db.commit();
      return refused(400, 'registration refused');
    }
    const credential = info.credential;
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
        challenges[0].user_handle,
        challenges[0].user_name,
        finishedAt,
      ],
    );
    await appendAudit(db, {
      action: 'auth.credential.add',
      detail: { credentialId: credential.id, purpose: decision.purpose },
      now: finishedAt,
    });
    if (decision.purpose === 'rebind') {
      await db.query(
        'DELETE FROM cms_auth_credentials WHERE credential_id <> ?',
        [credential.id],
      );
      await db.query(
        'UPDATE cms_auth_sessions SET revoked_at = ? WHERE token_hash <> ? AND revoked_at IS NULL',
        [finishedAt, decision.tokenHash],
      );
      await db.query(
        'UPDATE cms_auth_sessions SET credential_id = ? WHERE token_hash = ? AND revoked_at IS NULL',
        [credential.id, decision.tokenHash],
      );
    }
    await db.commit();
    return { ok: true, credentialId: credential.id };
  } catch (error) {
    await rollback(db);
    if (error && error.code === 'ER_DUP_ENTRY') return refused(409, 'credential already registered');
    throw error;
  }
}

export async function revokeCredential(db, { cookie, csrf, credentialId, now }) {
  const finishedAt = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  const decision = await openRecentSession(db, { cookie, csrf, now: finishedAt });
  if (!decision.ok) return decision;
  if (typeof credentialId !== 'string' || credentialId.length === 0) return refused(400, 'bad credential');
  await db.beginTransaction();
  try {
    const [creds] = await db.query(
      'SELECT credential_id FROM cms_auth_credentials ORDER BY credential_id FOR UPDATE',
    );
    if (creds.length <= 1) {
      await rollback(db);
      return refused(409, 'last credential stays');
    }
    if (!creds.some((row) => row.credential_id === credentialId)) {
      await rollback(db);
      return refused(404, 'missing credential');
    }
    await db.query('DELETE FROM cms_auth_credentials WHERE credential_id = ?', [credentialId]);
    await db.query(
      'UPDATE cms_auth_sessions SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL',
      [finishedAt, credentialId],
    );
    await appendAudit(db, {
      action: 'auth.credential.revoke',
      detail: { credentialId },
      now: finishedAt,
    });
    await db.commit();
    return { ok: true };
  } catch (error) {
    await rollback(db);
    throw error;
  }
}
