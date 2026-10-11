import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { isoCBOR } from '../cms/node_modules/@simplewebauthn/server/esm/helpers/iso/index.js';
import {
  beginAuthentication,
  finishAuthentication,
} from '../cms/src/lib/auth-login.js';
import {
  beginRegistration,
  finishRegistration,
  issueBootstrap,
} from '../cms/src/lib/auth-bootstrap.js';
import { beginCredential, finishCredential } from '../cms/src/lib/auth-credentials.js';
import { authorizeWrite } from '../cms/src/lib/auth-session.js';
import {
  consumeOfflineRebind,
  decryptTotpSecret,
  enableTotp,
  issueOfflineRebind,
  recoverAccess,
  totpAt,
} from '../cms/src/lib/auth-totp.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';

function keyedRegistration({ challenge, origin: pageOrigin }) {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const credentialId = crypto.randomBytes(16);
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const cose = isoCBOR.encode(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
  const rpIdHash = crypto.createHash('sha256').update('127.0.0.1').digest();
  const authData = Buffer.concat([
    rpIdHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16),
    Buffer.from([0, credentialId.length]), credentialId, Buffer.from(cose),
  ]);
  const attestation = isoCBOR.encode(new Map([
    ['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)],
  ]));
  const id = credentialId.toString('base64url');
  return {
    privateKey: pair.privateKey,
    response: {
      id, rawId: id, type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({
          type: 'webauthn.create', challenge, origin: pageOrigin,
        })).toString('base64url'),
        attestationObject: Buffer.from(attestation).toString('base64url'),
        transports: ['internal'],
      },
    },
  };
}

function signedAssertion({ privateKey, credentialId, challenge, counter }) {
  const rpIdHash = crypto.createHash('sha256').update('127.0.0.1').digest();
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter);
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), counterBuf]);
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge, origin,
  }));
  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signature = crypto.sign('sha256', Buffer.concat([authData, clientHash]), {
    key: privateKey, dsaEncoding: 'der',
  });
  const id = credentialId.toString('base64url');
  return {
    id, rawId: id, type: 'public-key',
    response: {
      clientDataJSON: clientDataJSON.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
}

test('totp recovery stores only hashes and a rebind session cannot write content', async (t) => {
  const mysql = await import('mysql2/promise');
  let root;
  try {
    root = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_authtotp');
  await root.query('CREATE DATABASE cms_authtotp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_authtotp',
  });
  const key = crypto.randomBytes(32);
  try {
    await ensureCmsSchema(db);
    const now = 1_700_000_000;
    const issued = await issueBootstrap(db, { now });
    const started = await beginRegistration(db, { secret: issued.secret, origin, now: now + 1 });
    const keyed = keyedRegistration({ challenge: started.options.challenge, origin });
    const registered = await finishRegistration(db, {
      secret: issued.secret, origin, now: now + 2, response: keyed.response,
    });
    assert.equal(registered.ok, true, registered.error);
    const login = await beginAuthentication(db, { origin, now: now + 3 });
    const session = await finishAuthentication(db, {
      origin,
      now: now + 4,
      response: signedAssertion({
        privateKey: keyed.privateKey,
        credentialId: Buffer.from(keyed.response.id, 'base64url'),
        challenge: login.options.challenge,
        counter: 1,
      }),
    });
    assert.equal(session.ok, true, session.error);
    const cookie = session.cookie.split(';')[0];
    const enabled = await enableTotp(db, {
      cookie, csrf: session.csrfToken, now: now + 5, key,
    });
    assert.equal(enabled.ok, true, enabled.error);
    assert.equal(enabled.recoveryCodes.length, 8);
    const [stored] = await db.query('SELECT secret_enc FROM cms_auth_totp WHERE id = 1');
    const raw = decryptTotpSecret(stored[0].secret_enc, key);
    assert.equal(stored[0].secret_enc.toString('utf8').includes(enabled.secret), false);
    const [hashes] = await db.query('SELECT code_hash FROM cms_auth_recovery_codes');
    const expected = crypto.createHash('sha256').update(enabled.recoveryCodes[0], 'utf8').digest('hex');
    assert.ok(hashes.some((row) => row.code_hash === expected));
    assert.equal(hashes.some((row) => row.code_hash === enabled.recoveryCodes[0]), false);
    const [audit] = await db.query(`SELECT detail FROM cms_audit_log WHERE action = 'auth.totp.enable'`);
    assert.equal(String(audit[0].detail).includes(enabled.secret), false);

    for (let i = 0; i < 5; i += 1) {
      const failed = await recoverAccess(db, {
        code: '000000', recoveryCode: 'nope', now: now + 6, key,
      });
      assert.equal(failed.status, 403);
    }
    const limited = await recoverAccess(db, {
      code: totpAt(raw, now + 6),
      recoveryCode: enabled.recoveryCodes[0],
      now: now + 6,
      key,
    });
    assert.equal(limited.status, 429);
    const recovered = await recoverAccess(db, {
      code: totpAt(raw, now + 700),
      recoveryCode: enabled.recoveryCodes[0],
      now: now + 700,
      key,
    });
    assert.equal(recovered.ok, true, recovered.error);
    assert.match(recovered.cookie, /Max-Age=600$/);
    const replay = await recoverAccess(db, {
      code: totpAt(raw, now + 700),
      recoveryCode: enabled.recoveryCodes[1],
      now: now + 700,
      key,
    });
    assert.equal(replay.status, 403);
    const old = await authorizeWrite(db, { cookie, csrf: session.csrfToken, now: now + 701 });
    assert.equal(old.status, 401);
    const rebound = await authorizeWrite(db, {
      cookie: recovered.cookie.split(';')[0], csrf: recovered.csrfToken, now: now + 701,
    });
    assert.equal(rebound.status, 403);
    const adding = await beginCredential(db, {
      origin,
      cookie: recovered.cookie.split(';')[0],
      csrf: recovered.csrfToken,
      now: now + 702,
    });
    assert.equal(adding.ok, true, adding.error);
    const replacement = keyedRegistration({ challenge: adding.options.challenge, origin });
    const confirmed = await finishCredential(db, {
      origin,
      cookie: recovered.cookie.split(';')[0],
      csrf: recovered.csrfToken,
      now: now + 703,
      response: replacement.response,
    });
    assert.equal(confirmed.ok, true, confirmed.error);
    const [left] = await db.query('SELECT credential_id FROM cms_auth_credentials');
    assert.equal(left.length, 1);
    assert.equal(left[0].credential_id, confirmed.credentialId);
    const [rebind] = await db.query(
      `SELECT credential_id FROM cms_auth_sessions WHERE purpose = 'rebind' AND revoked_at IS NULL`,
    );
    assert.equal(rebind[0].credential_id, confirmed.credentialId);
    const again = await beginRegistration(db, { secret: 'another', origin, now: now + 704 });
    assert.equal(again.status, 403);

    const offline = await issueOfflineRebind(db, { now: now + 704 });
    assert.equal(offline.ok, true, offline.error);
    const [offlineRow] = await db.query('SELECT secret_hash FROM cms_auth_offline_rebind WHERE id = 1');
    assert.notEqual(offlineRow[0].secret_hash, offline.secret);
    const consumed = await consumeOfflineRebind(db, { secret: offline.secret, now: now + 705 });
    assert.equal(consumed.ok, true, consumed.error);
    assert.equal(consumed.cookie.includes('Max-Age=600'), true);
  } finally {
    await db.end();
  }
});

test('the offline rebind command prints the secret once', async (t) => {
  const mysql = await import('mysql2/promise');
  let root;
  try {
    root = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_authoffline');
  await root.query('CREATE DATABASE cms_authoffline CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();
  const first = spawnSync(process.execPath, ['scripts/cms-auth-offline-rebind.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_USER: 'root',
      DB_PASSWORD: '',
      DB_NAME: 'cms_authoffline',
    },
    encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout.trim(), /^[0-9a-f]{64}$/);
  const second = spawnSync(process.execPath, ['scripts/cms-auth-offline-rebind.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_USER: 'root',
      DB_PASSWORD: '',
      DB_NAME: 'cms_authoffline',
    },
    encoding: 'utf8',
  });
  assert.equal(second.status, 65);
  assert.equal(second.stdout.includes(first.stdout.trim()), false);
});
