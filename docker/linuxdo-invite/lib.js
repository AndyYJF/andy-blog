import crypto from 'node:crypto';
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
    } catch (err) {
      console.error(`linuxdo-invite: cannot read ${fromFile}: ${err?.code || err}`);
      fileEnv = {};
    }
  }

  const inviteUrl = (env.LINUXDO_INVITE_URL || fileEnv.LINUXDO_INVITE_URL || '').trim();
  const note = (env.LINUXDO_INVITE_NOTE || fileEnv.LINUXDO_INVITE_NOTE || '').trim();
  const difficulty = Number(env.LINUXDO_POW_DIFFICULTY || fileEnv.LINUXDO_POW_DIFFICULTY || 4);
  return {
    inviteUrl,
    note,
    difficulty: Number.isFinite(difficulty) ? Math.min(6, Math.max(3, Math.floor(difficulty))) : 4,
  };
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

export function hashPow(salt, nonce) {
  return crypto.createHash('sha256').update(`${salt}:${nonce}`).digest('hex');
}

export function meetsDifficulty(hex, difficulty) {
  return hex.startsWith('0'.repeat(difficulty));
}

export function verifyPow({ salt, nonce, difficulty }) {
  const n = String(nonce ?? '');
  if (!/^[0-9]{1,16}$/.test(n)) return false;
  return meetsDifficulty(hashPow(salt, n), difficulty);
}

/** In-memory one-time PoW challenges (single container). */
export function createChallengeStore({ ttlMs = 5 * 60_000, now = () => Date.now() } = {}) {
  const map = new Map();

  const prune = () => {
    const t = now();
    for (const [id, row] of map) {
      if (row.expiresAt <= t) map.delete(id);
    }
  };

  return {
    issue(difficulty) {
      prune();
      const id = crypto.randomBytes(16).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const expiresAt = now() + ttlMs;
      map.set(id, { salt, difficulty, expiresAt, used: false });
      return { id, salt, difficulty, expiresIn: Math.floor(ttlMs / 1000) };
    },
    consume(id, nonce) {
      prune();
      const row = map.get(id);
      if (!row) return { ok: false, error: 'challenge_missing' };
      if (row.used) return { ok: false, error: 'challenge_used' };
      if (row.expiresAt <= now()) {
        map.delete(id);
        return { ok: false, error: 'challenge_expired' };
      }
      if (!verifyPow({ salt: row.salt, nonce, difficulty: row.difficulty })) {
        return { ok: false, error: 'pow_failed' };
      }
      row.used = true;
      map.delete(id);
      return { ok: true };
    },
    size: () => map.size,
  };
}
