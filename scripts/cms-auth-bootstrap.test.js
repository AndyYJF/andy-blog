import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { isoCBOR } from '../cms/node_modules/@simplewebauthn/server/esm/helpers/iso/index.js';
import {
  beginRegistration,
  finishRegistration,
  hashBootstrapSecret,
  issueBootstrap,
} from '../cms/src/lib/auth-bootstrap.js';
import {
  beginAuthentication,
  finishAuthentication,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_SLIDING_SECONDS,
} from '../cms/src/lib/auth-login.js';
import { authorizeWrite, revokeSession, writeNeedsSession } from '../cms/src/lib/auth-session.js';
import {
  beginCredential,
  beginReauth,
  finishCredential,
  finishReauth,
  revokeCredential,
} from '../cms/src/lib/auth-credentials.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';

async function openRoot() {
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
  });
}

test('an empty database cannot register an admin without the one-time secret', async (t) => {
  let root;
  try {
    root = await openRoot();
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_auth');
  await root.query('CREATE DATABASE cms_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const mysql = await import('mysql2/promise');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_auth',
  });
  try {
    await ensureCmsSchema(db);
    const [version] = await db.query(
      'SELECT version FROM cms_schema_migrations WHERE version = 2',
    );
    assert.equal(version.length, 1);
    const anonymous = await beginRegistration(db, { secret: '', origin, now: 1_700_000_000 });
    assert.equal(anonymous.status, 403);
    const [none] = await db.query('SELECT COUNT(*) AS n FROM cms_auth_challenges');
    assert.equal(Number(none[0].n), 0);

    const now = 1_700_000_000;
    const issued = await issueBootstrap(db, { now });
    assert.equal(issued.ok, true, issued.error);
    assert.notEqual(issued.secret, hashBootstrapSecret(issued.secret));
    const [stored] = await db.query('SELECT secret_hash, uses_remaining FROM cms_auth_bootstrap WHERE id = 1');
    assert.equal(stored[0].secret_hash, hashBootstrapSecret(issued.secret));
    assert.equal(stored[0].secret_hash.includes(issued.secret), false);
    const again = await issueBootstrap(db, { now: now + 1 });
    assert.equal(again.status, 65);

    const wrong = await beginRegistration(db, { secret: 'nope', origin, now: now + 1 });
    assert.equal(wrong.status, 403);
    const started = await beginRegistration(db, { secret: issued.secret, origin, now: now + 1 });
    assert.equal(started.ok, true, started.error);
    assert.equal(started.options.rp.id, '127.0.0.1');
    assert.equal(started.options.authenticatorSelection.userVerification, 'required');
    assert.equal(started.options.authenticatorSelection.residentKey, 'required');

    const refused = await finishRegistration(db, {
      secret: issued.secret,
      origin,
      now: now + 2,
      response: { id: 'not-a-credential', rawId: 'not-a-credential', type: 'public-key', response: {} },
    });
    assert.equal(refused.status, 400);
    const [left] = await db.query(
      'SELECT uses_remaining FROM cms_auth_bootstrap WHERE id = 1',
    );
    const [admins] = await db.query('SELECT COUNT(*) AS n FROM cms_auth_admin');
    const [used] = await db.query('SELECT used_at FROM cms_auth_challenges');
    assert.equal(Number(left[0].uses_remaining), 1);
    assert.equal(Number(admins[0].n), 0);
    assert.ok(used[0].used_at != null);

    const expired = await beginRegistration(db, {
      secret: issued.secret,
      origin,
      now: now + 15 * 60 + 1,
    });
    assert.equal(expired.status, 403);
  } finally {
    await db.end();
  }
});

test('the offline command prints the secret once and will not replace it while it is valid', async (t) => {
  let root;
  try {
    root = await openRoot();
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_authcli');
  await root.query('CREATE DATABASE cms_authcli CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const env = {
    ...process.env,
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'cms_authcli',
  };
  const first = spawnSync(process.execPath, ['scripts/cms-bootstrap-admin.js'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  const secret = first.stdout.trim();
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(first.stderr.includes(secret), false);
  const second = spawnSync(process.execPath, ['scripts/cms-bootstrap-admin.js'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(second.status, 65);
  assert.equal(second.stdout.includes(secret), false);
});

function coseEs256() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  return isoCBOR.encode(new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
}

function noneRegistration({ challenge, origin, userVerified }) {
  const credentialId = crypto.randomBytes(16);
  const rpIdHash = crypto.createHash('sha256').update('127.0.0.1').digest();
  const flags = userVerified ? 0x45 : 0x41;
  const authData = Buffer.concat([
    rpIdHash,
    Buffer.from([flags]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([0, credentialId.length]),
    credentialId,
    Buffer.from(coseEs256()),
  ]);
  const attestation = isoCBOR.encode(new Map([
    ['fmt', 'none'],
    ['attStmt', new Map()],
    ['authData', new Uint8Array(authData)],
  ]));
  const id = credentialId.toString('base64url');
  return {
    id,
    rawId: id,
    type: 'public-key',
    response: {
      clientDataJSON: Buffer.from(JSON.stringify({
        type: 'webauthn.create',
        challenge,
        origin,
      })).toString('base64url'),
      attestationObject: Buffer.from(attestation).toString('base64url'),
      transports: ['internal'],
    },
  };
}

test('a verified registration stores the passkey and retires the secret', async (t) => {
  let root;
  try {
    root = await openRoot();
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_authpass');
  await root.query('CREATE DATABASE cms_authpass CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const mysql = await import('mysql2/promise');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_authpass',
  });
  try {
    await ensureCmsSchema(db);
    const now = 1_700_000_000;
    const issued = await issueBootstrap(db, { now });
    assert.equal(issued.ok, true, issued.error);
    const started = await beginRegistration(db, { secret: issued.secret, origin, now: now + 1 });
    assert.equal(started.ok, true, started.error);
    const unverified = await finishRegistration(db, {
      secret: issued.secret,
      origin,
      now: now + 2,
      response: noneRegistration({
        challenge: started.options.challenge,
        origin,
        userVerified: false,
      }),
    });
    assert.equal(unverified.status, 400);
    const [still] = await db.query('SELECT uses_remaining FROM cms_auth_bootstrap WHERE id = 1');
    const [noAdmin] = await db.query('SELECT COUNT(*) AS n FROM cms_auth_admin');
    assert.equal(Number(still[0].uses_remaining), 1);
    assert.equal(Number(noAdmin[0].n), 0);

    const again = await beginRegistration(db, { secret: issued.secret, origin, now: now + 3 });
    const registered = await finishRegistration(db, {
      secret: issued.secret,
      origin,
      now: now + 4,
      response: noneRegistration({
        challenge: again.options.challenge,
        origin,
        userVerified: true,
      }),
    });
    assert.equal(registered.ok, true, registered.error);
    const [row] = await db.query(
      `SELECT credential_id, counter, transports, device_type, backed_up, user_verified
       FROM cms_auth_credentials`,
    );
    const [boot] = await db.query('SELECT uses_remaining FROM cms_auth_bootstrap WHERE id = 1');
    const [audit] = await db.query(`SELECT detail FROM cms_audit_log WHERE action = 'auth.register'`);
    assert.equal(row[0].credential_id, registered.credentialId);
    assert.equal(Number(row[0].counter), 0);
    assert.equal(row[0].transports, 'internal');
    assert.equal(row[0].device_type, 'singleDevice');
    assert.equal(Number(row[0].backed_up), 0);
    assert.equal(Number(row[0].user_verified), 1);
    assert.equal(Number(boot[0].uses_remaining), 0);
    assert.equal(String(audit[0].detail).includes(issued.secret), false);
    const closed = await beginRegistration(db, { secret: issued.secret, origin, now: now + 5 });
    assert.equal(closed.status, 403);
    const replaced = await issueBootstrap(db, { now: now + 6, replace: true });
    assert.equal(replaced.status, 65);
  } finally {
    await db.end();
  }
});

function coseFromPublic(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return isoCBOR.encode(new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
}

function keyedRegistration({ challenge, origin }) {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const credentialId = crypto.randomBytes(16);
  const rpIdHash = crypto.createHash('sha256').update('127.0.0.1').digest();
  const authData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([0, credentialId.length]),
    credentialId,
    Buffer.from(coseFromPublic(pair.publicKey)),
  ]);
  const attestation = isoCBOR.encode(new Map([
    ['fmt', 'none'],
    ['attStmt', new Map()],
    ['authData', new Uint8Array(authData)],
  ]));
  const id = credentialId.toString('base64url');
  return {
    privateKey: pair.privateKey,
    response: {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({
          type: 'webauthn.create',
          challenge,
          origin,
        })).toString('base64url'),
        attestationObject: Buffer.from(attestation).toString('base64url'),
        transports: ['internal'],
      },
    },
  };
}

function signedAssertion({ privateKey, credentialId, challenge, origin, counter, userVerified }) {
  const rpIdHash = crypto.createHash('sha256').update('127.0.0.1').digest();
  const flags = userVerified ? 0x05 : 0x01;
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter);
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf]);
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge,
    origin,
  }));
  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signature = crypto.sign('sha256', Buffer.concat([authData, clientHash]), {
    key: privateKey,
    dsaEncoding: 'der',
  });
  const id = credentialId.toString('base64url');
  return {
    id,
    rawId: id,
    type: 'public-key',
    response: {
      clientDataJSON: clientDataJSON.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
}

test('a signed login stores a hashed session and rejects a replayed counter', async (t) => {
  let root;
  try {
    root = await openRoot();
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_authlogin');
  await root.query('CREATE DATABASE cms_authlogin CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const mysql = await import('mysql2/promise');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_authlogin',
  });
  try {
    await ensureCmsSchema(db);
    const now = 1_700_000_000;
    const missing = await beginAuthentication(db, { origin, now });
    assert.equal(missing.status, 403);
    const [noChallenge] = await db.query(
      `SELECT COUNT(*) AS n FROM cms_auth_challenges WHERE flow = 'authentication'`,
    );
    assert.equal(Number(noChallenge[0].n), 0);

    const issued = await issueBootstrap(db, { now });
    const started = await beginRegistration(db, { secret: issued.secret, origin, now: now + 1 });
    const keyed = keyedRegistration({ challenge: started.options.challenge, origin });
    const registered = await finishRegistration(db, {
      secret: issued.secret,
      origin,
      now: now + 2,
      response: keyed.response,
    });
    assert.equal(registered.ok, true, registered.error);

    const login = await beginAuthentication(db, { origin, now: now + 3 });
    assert.equal(login.ok, true, login.error);
    assert.equal(login.options.userVerification, 'required');
    assert.equal(login.options.allowCredentials[0].id, keyed.response.id);
    const unverified = await finishAuthentication(db, {
      origin,
      now: now + 4,
      response: signedAssertion({
        privateKey: keyed.privateKey,
        credentialId: Buffer.from(keyed.response.id, 'base64url'),
        challenge: login.options.challenge,
        origin,
        counter: 1,
        userVerified: false,
      }),
    });
    assert.equal(unverified.status, 400);
    const [still] = await db.query('SELECT counter FROM cms_auth_credentials');
    assert.equal(Number(still[0].counter), 0);

    const next = await beginAuthentication(db, { origin, now: now + 5 });
    const signed = signedAssertion({
      privateKey: keyed.privateKey,
      credentialId: Buffer.from(keyed.response.id, 'base64url'),
      challenge: next.options.challenge,
      origin,
      counter: 1,
      userVerified: true,
    });
    const logged = await finishAuthentication(db, { origin, now: now + 6, response: signed });
    assert.equal(logged.ok, true, logged.error);
    assert.match(logged.cookie, /^__Host-cms=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
    assert.equal(logged.cookie.includes('Domain='), false);
    const token = logged.cookie.slice('__Host-cms='.length, logged.cookie.indexOf(';'));
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    const [session] = await db.query(
      'SELECT token_hash, idle_until, absolute_until, revoked_at FROM cms_auth_sessions',
    );
    const [counter] = await db.query('SELECT counter FROM cms_auth_credentials');
    const [audit] = await db.query(`SELECT detail FROM cms_audit_log WHERE action = 'auth.login'`);
    assert.equal(session[0].token_hash, tokenHash);
    assert.equal(session[0].token_hash.includes(token), false);
    assert.equal(Number(session[0].idle_until), now + 6 + SESSION_SLIDING_SECONDS);
    assert.equal(Number(session[0].absolute_until), now + 6 + SESSION_ABSOLUTE_SECONDS);
    assert.equal(session[0].revoked_at, null);
    assert.equal(Number(counter[0].counter), 1);
    assert.equal(String(audit[0].detail).includes(token), false);
    assert.equal(String(audit[0].detail).includes(logged.csrfToken), false);
    assert.equal(writeNeedsSession('POST', '/api/preview'), false);
    assert.equal(writeNeedsSession('PUT', '/api/contents/1'), true);
    const cookie = `theme=dark; ${logged.cookie.split(';')[0]}`;
    const allowed = await authorizeWrite(db, {
      cookie,
      csrf: logged.csrfToken,
      now: now + 7,
    });
    assert.equal(allowed.ok, true, allowed.error);
    const [slid] = await db.query('SELECT idle_until FROM cms_auth_sessions');
    assert.equal(Number(slid[0].idle_until), now + 7 + SESSION_SLIDING_SECONDS);
    const wrong = await authorizeWrite(db, { cookie, csrf: 'nope', now: now + 8 });
    assert.equal(wrong.status, 403);
    const [unslid] = await db.query('SELECT idle_until FROM cms_auth_sessions');
    assert.equal(Number(unslid[0].idle_until), now + 7 + SESSION_SLIDING_SECONDS);
    const anonymous = await authorizeWrite(db, { cookie: '', csrf: logged.csrfToken, now: now + 7 });
    assert.equal(anonymous.status, 401);
    await db.query('UPDATE cms_auth_sessions SET absolute_until = ? WHERE token_hash = ?', [
      now + 8,
      tokenHash,
    ]);
    const expired = await authorizeWrite(db, { cookie, csrf: logged.csrfToken, now: now + 8 });
    assert.equal(expired.status, 401);

    const replayChallenge = await beginAuthentication(db, { origin, now: now + 7 });
    const replay = await finishAuthentication(db, {
      origin,
      now: now + 8,
      response: signedAssertion({
        privateKey: keyed.privateKey,
        credentialId: Buffer.from(keyed.response.id, 'base64url'),
        challenge: replayChallenge.options.challenge,
        origin,
        counter: 1,
        userVerified: true,
      }),
    });
    assert.equal(replay.status, 400);
    const [after] = await db.query('SELECT counter FROM cms_auth_credentials');
    const [sessions] = await db.query('SELECT COUNT(*) AS n FROM cms_auth_sessions');
    assert.equal(Number(after[0].counter), 1);
    assert.equal(Number(sessions[0].n), 1);
  } finally {
    await db.end();
  }
});

function cookieHeader(logged) {
  return logged.cookie.split(';')[0];
}

test('login retires older sessions and the last passkey cannot be removed', async (t) => {
  let root;
  try {
    root = await openRoot();
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_authkeys');
  await root.query('CREATE DATABASE cms_authkeys CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const mysql = await import('mysql2/promise');
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_authkeys',
  });
  try {
    await ensureCmsSchema(db);
    const now = 1_700_000_000;
    const issued = await issueBootstrap(db, { now });
    const started = await beginRegistration(db, { secret: issued.secret, origin, now: now + 1 });
    const first = keyedRegistration({ challenge: started.options.challenge, origin });
    const registered = await finishRegistration(db, {
      secret: issued.secret, origin, now: now + 2, response: first.response,
    });
    assert.equal(registered.ok, true, registered.error);
    const credentialA = Buffer.from(first.response.id, 'base64url');

    const firstLogin = await beginAuthentication(db, { origin, now: now + 3 });
    const session1 = await finishAuthentication(db, {
      origin,
      now: now + 4,
      response: signedAssertion({
        privateKey: first.privateKey, credentialId: credentialA,
        challenge: firstLogin.options.challenge, origin, counter: 1, userVerified: true,
      }),
    });
    const secondLogin = await beginAuthentication(db, { origin, now: now + 5 });
    const session2 = await finishAuthentication(db, {
      origin,
      now: now + 6,
      response: signedAssertion({
        privateKey: first.privateKey, credentialId: credentialA,
        challenge: secondLogin.options.challenge, origin, counter: 2, userVerified: true,
      }),
    });
    assert.equal(session2.ok, true, session2.error);
    const retired = await authorizeWrite(db, {
      cookie: cookieHeader(session1), csrf: session1.csrfToken, now: now + 7,
    });
    assert.equal(retired.status, 401);

    const stale = await beginCredential(db, {
      origin, cookie: cookieHeader(session2), csrf: session2.csrfToken, now: now + 6 + 301,
    });
    assert.equal(stale.status, 403);
    const [noAdd] = await db.query(
      `SELECT COUNT(*) AS n FROM cms_auth_challenges WHERE flow = 'credential'`,
    );
    assert.equal(Number(noAdd[0].n), 0);

    const reauth = await beginReauth(db, {
      origin, cookie: cookieHeader(session2), csrf: session2.csrfToken, now: now + 310,
    });
    assert.equal(reauth.ok, true, reauth.error);
    const refreshed = await finishReauth(db, {
      origin,
      cookie: cookieHeader(session2),
      csrf: session2.csrfToken,
      now: now + 311,
      response: signedAssertion({
        privateKey: first.privateKey, credentialId: credentialA,
        challenge: reauth.options.challenge, origin, counter: 3, userVerified: true,
      }),
    });
    assert.equal(refreshed.ok, true, refreshed.error);

    const adding = await beginCredential(db, {
      origin, cookie: cookieHeader(session2), csrf: session2.csrfToken, now: now + 312,
    });
    assert.equal(adding.ok, true, adding.error);
    assert.equal(adding.options.excludeCredentials[0].id, first.response.id);
    const second = keyedRegistration({ challenge: adding.options.challenge, origin });
    const added = await finishCredential(db, {
      origin,
      cookie: cookieHeader(session2),
      csrf: session2.csrfToken,
      now: now + 313,
      response: second.response,
    });
    assert.equal(added.ok, true, added.error);
    const [both] = await db.query('SELECT COUNT(*) AS n FROM cms_auth_credentials');
    assert.equal(Number(both[0].n), 2);

    const removed = await revokeCredential(db, {
      cookie: cookieHeader(session2),
      csrf: session2.csrfToken,
      credentialId: first.response.id,
      now: now + 314,
    });
    assert.equal(removed.ok, true, removed.error);
    const afterRemove = await authorizeWrite(db, {
      cookie: cookieHeader(session2), csrf: session2.csrfToken, now: now + 315,
    });
    assert.equal(afterRemove.status, 401);

    const credentialB = Buffer.from(second.response.id, 'base64url');
    const loginB = await beginAuthentication(db, { origin, now: now + 316 });
    const sessionB = await finishAuthentication(db, {
      origin,
      now: now + 317,
      response: signedAssertion({
        privateKey: second.privateKey, credentialId: credentialB,
        challenge: loginB.options.challenge, origin, counter: 1, userVerified: true,
      }),
    });
    assert.equal(sessionB.ok, true, sessionB.error);
    const last = await revokeCredential(db, {
      cookie: cookieHeader(sessionB),
      csrf: sessionB.csrfToken,
      credentialId: second.response.id,
      now: now + 318,
    });
    assert.equal(last.status, 409);
    const [left] = await db.query(
      'SELECT credential_id FROM cms_auth_credentials',
    );
    assert.equal(left[0].credential_id, second.response.id);
    const loggedOut = await revokeSession(db, {
      cookie: cookieHeader(sessionB), csrf: sessionB.csrfToken, now: now + 319,
    });
    assert.equal(loggedOut.ok, true, loggedOut.error);
    const gone = await authorizeWrite(db, {
      cookie: cookieHeader(sessionB), csrf: sessionB.csrfToken, now: now + 320,
    });
    assert.equal(gone.status, 401);
  } finally {
    await db.end();
  }
});
