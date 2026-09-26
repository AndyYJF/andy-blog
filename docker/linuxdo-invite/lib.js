import fs from 'node:fs';

const INVITE_URL_RE = /^https:\/\/linux\.do\/invites\/[A-Za-z0-9_-]+$/;

export function readInviteConfig(env = process.env) {
  const fromFile = env.LINUXDO_INVITE_ENV_FILE;
  let fileEnv = {};
  if (fromFile) {
    try {
      const text = fs.readFileSync(fromFile, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        fileEnv[key] = value;
      }
    } catch {
      fileEnv = {};
    }
  }

  const secret = (env.TURNSTILE_SECRET_KEY || fileEnv.TURNSTILE_SECRET_KEY || '').trim();
  const inviteUrl = (env.LINUXDO_INVITE_URL || fileEnv.LINUXDO_INVITE_URL || '').trim();
  const note = (env.LINUXDO_INVITE_NOTE || fileEnv.LINUXDO_INVITE_NOTE || '').trim();
  return { secret, inviteUrl, note };
}

export function claimInvite(config) {
  if (!INVITE_URL_RE.test(config.inviteUrl)) {
    const err = new Error('invalid invite url');
    err.status = 503;
    throw err;
  }
  const body = { ok: true, inviteUrl: config.inviteUrl };
  if (config.note) body.note = config.note.slice(0, 120);
  return body;
}

export async function verifyTurnstile({ secret, token, ip, fetchImpl = fetch }) {
  if (process.env.LINUXDO_CLAIM_DEV === '1' && token === 'dev-ok') return true;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data?.success === true;
}
