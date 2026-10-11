import { beginRegistration, finishRegistration } from './auth-bootstrap.js';
import {
  beginCredential,
  beginReauth,
  finishCredential,
  finishReauth,
  revokeCredential,
} from './auth-credentials.js';
import { beginAuthentication, finishAuthentication } from './auth-login.js';
import { logoutSession } from './auth-session.js';
import { enableTotp, recoverAccess } from './auth-totp.js';
import { withCmsDb } from './db.js';

const PUBLIC_FIELDS = ['csrfToken', 'credentialId', 'options', 'secret', 'recoveryCodes'];

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function totpKeyFromEnv(env = process.env) {
  const raw = env.CMS_TOTP_KEY;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) return null;
  return key;
}

export function authHttpResponse(result) {
  if (!result || result.ok !== true) {
    return json({ error: result?.error || 'refused' }, result?.status || 400);
  }
  const headers = {};
  if (typeof result.cookie === 'string') headers['set-cookie'] = result.cookie;
  const body = { ok: true };
  for (const key of PUBLIC_FIELDS) {
    if (result[key] !== undefined) body[key] = result[key];
  }
  return json(body, 200, headers);
}

async function readBody(request) {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function handleAuthPost(kind, request) {
  const parsed = await readBody(request);
  if (!parsed.ok) return json({ error: 'bad json' }, 400);
  const body = parsed.body || {};
  const origin = request.headers.get('origin') || '';
  const cookie = request.headers.get('cookie');
  const csrf = request.headers.get('x-csrf-token');
  const now = Math.floor(Date.now() / 1000);
  try {
    return await withCmsDb(async (db) => {
      if (kind === 'login' && body.step === 'begin') {
        return authHttpResponse(await beginAuthentication(db, { origin, now }));
      }
      if (kind === 'login' && body.step === 'finish') {
        return authHttpResponse(await finishAuthentication(db, { origin, now, response: body.response }));
      }
      if (kind === 'register' && body.step === 'begin') {
        return authHttpResponse(await beginRegistration(db, { origin, now, secret: body.secret }));
      }
      if (kind === 'register' && body.step === 'finish') {
        return authHttpResponse(await finishRegistration(db, {
          origin, now, secret: body.secret, response: body.response,
        }));
      }
      if (kind === 'recover') {
        const key = totpKeyFromEnv();
        if (!key) return json({ error: 'totp key is not configured' }, 503);
        return authHttpResponse(await recoverAccess(db, {
          code: body.code, recoveryCode: body.recoveryCode, now, key,
        }));
      }
      if (kind === 'logout') return authHttpResponse(await logoutSession(db, { cookie, csrf, now }));
      if (kind === 'reauth' && body.step === 'begin') {
        return authHttpResponse(await beginReauth(db, { origin, cookie, csrf, now }));
      }
      if (kind === 'reauth' && body.step === 'finish') {
        return authHttpResponse(await finishReauth(db, { origin, cookie, csrf, now, response: body.response }));
      }
      if (kind === 'credentials' && body.step === 'begin') {
        return authHttpResponse(await beginCredential(db, { origin, cookie, csrf, now }));
      }
      if (kind === 'credentials' && body.step === 'finish') {
        return authHttpResponse(await finishCredential(db, {
          origin, cookie, csrf, now, response: body.response,
        }));
      }
      if (kind === 'credentials' && body.step === 'revoke') {
        return authHttpResponse(await revokeCredential(db, { cookie, csrf, credentialId: body.credentialId, now }));
      }
      if (kind === 'totp') {
        const key = totpKeyFromEnv();
        if (!key) return json({ error: 'totp key is not configured' }, 503);
        return authHttpResponse(await enableTotp(db, { cookie, csrf, now, key }));
      }
      return json({ error: 'bad auth step' }, 400);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}
