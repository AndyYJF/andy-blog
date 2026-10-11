import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { isoCBOR } from '../cms/node_modules/@simplewebauthn/server/esm/helpers/iso/index.js';
import { issueBootstrap } from '../cms/src/lib/auth-bootstrap.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const origin = 'http://127.0.0.1:4322';

function keyedRegistration({ challenge }) {
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
    credentialId,
    response: {
      id, rawId: id, type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({
          type: 'webauthn.create', challenge, origin,
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

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let value = 0;
  let bits = 0;
  const out = [];
  for (const char of text) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function post(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('auth HTTP routes set a host cookie and do not accept an anonymous registration', async (t) => {
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
  await root.query('DROP DATABASE IF EXISTS cms_authhttp');
  await root.query('CREATE DATABASE cms_authhttp CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.query("CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms-dev'");
  await root.query("GRANT ALL PRIVILEGES ON cms_authhttp.* TO 'cms'@'127.0.0.1'");
  await root.query('FLUSH PRIVILEGES');
  const setup = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_authhttp',
  });
  await ensureCmsSchema(setup);
  const issued = await issueBootstrap(setup, { now: Math.floor(Date.now() / 1000) - 5 });
  await setup.end();
  await root.end();
  assert.equal(issued.ok, true, issued.error);

  process.env.CMS_DB_HOST = '127.0.0.1';
  process.env.CMS_DB_PORT = '3307';
  process.env.CMS_DB_USER = 'cms';
  process.env.CMS_DB_PASSWORD = 'cms-dev';
  process.env.CMS_DB_NAME = 'cms_authhttp';
  process.env.CMS_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
  const register = await import('../cms/src/pages/api/auth/register.js');
  const login = await import('../cms/src/pages/api/auth/login.js');
  const logout = await import('../cms/src/pages/api/auth/logout.js');
  const recover = await import('../cms/src/pages/api/auth/recover.js');
  const totp = await import('../cms/src/pages/api/auth/totp.js');
  const reauth = await import('../cms/src/pages/api/auth/reauth.js');
  const credentials = await import('../cms/src/pages/api/auth/credentials.js');
  const { totpAt } = await import('../cms/src/lib/auth-totp.js');
  const { onRequest } = await import('../cms/src/middleware.js');
  const { closeCmsDb } = await import('../cms/src/lib/db.js');
  const { authWriteGate } = await import('../cms/src/lib/auth-session.js');
  let probe;
  try {
    assert.equal(authWriteGate('POST', '/api/auth/recover'), 'none');
    assert.equal(authWriteGate('POST', '/api/auth/credentials'), 'passkey');
    assert.equal(authWriteGate('PUT', '/api/contents/1'), 'write');

    const anonymous = await register.POST({
      request: post('http://127.0.0.1:4322/api/auth/register', { step: 'begin' }),
    });
    assert.equal(anonymous.status, 403);

    const started = await register.POST({
      request: post('http://127.0.0.1:4322/api/auth/register', { step: 'begin', secret: issued.secret }),
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const startedBody = JSON.parse(startedText);
    assert.equal(startedText.includes(issued.secret), false);
    const keyed = keyedRegistration({ challenge: startedBody.options.challenge });
    const registered = await register.POST({
      request: post('http://127.0.0.1:4322/api/auth/register', {
        step: 'finish', secret: issued.secret, response: keyed.response,
      }),
    });
    assert.equal(registered.status, 200, await registered.clone().text());

    const began = await login.POST({
      request: post('http://127.0.0.1:4322/api/auth/login', { step: 'begin' }),
    });
    const beganBody = JSON.parse(await began.text());
    assert.equal(began.status, 200, beganBody.error);
    const assertion = signedAssertion({
      privateKey: keyed.privateKey,
      credentialId: keyed.credentialId,
      challenge: beganBody.options.challenge,
      counter: 1,
    });
    const logged = await login.POST({
      request: post('http://127.0.0.1:4322/api/auth/login', { step: 'finish', response: assertion }),
    });
    const loggedText = await logged.text();
    assert.equal(logged.status, 200, loggedText);
    const cookie = logged.headers.get('set-cookie');
    const token = cookie.slice('__Host-cms='.length, cookie.indexOf(';'));
    assert.match(cookie, /^__Host-cms=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
    assert.equal(cookie.includes('Domain='), false);
    assert.equal(loggedText.includes(token), false);
    const loggedBody = JSON.parse(loggedText);
    assert.equal(typeof loggedBody.csrfToken, 'string');

    const context = { clientAddress: '127.0.0.1', locals: {} };
    const denied = await onRequest({
      ...context,
      request: post('http://127.0.0.1:4322/api/contents/1', { text: 'x', baseRevision: 0 }),
    }, async () => new Response('reached'));
    assert.equal(denied.status, 401);
    const openLogin = await onRequest({
      ...context,
      request: post('http://127.0.0.1:4322/api/auth/login', { step: 'begin' }),
    }, async () => new Response('reached'));
    assert.equal(openLogin.status, 200);
    const openRecover = await onRequest({
      ...context,
      request: post('http://127.0.0.1:4322/api/auth/recover', { code: '000000', recoveryCode: 'nope' }),
    }, async () => new Response('reached'));
    assert.equal(openRecover.status, 200);
    const needsPasskey = await onRequest({
      ...context,
      request: post('http://127.0.0.1:4322/api/auth/credentials', { step: 'begin' }),
    }, async () => new Response('reached'));
    assert.equal(needsPasskey.status, 401);

    const sessionHeaders = { cookie: cookie.split(';')[0], 'x-csrf-token': loggedBody.csrfToken };
    const beforeTotp = await recover.POST({
      request: post('http://127.0.0.1:4322/api/auth/recover', { code: '000000', recoveryCode: 'missing' }),
    });
    assert.equal(beforeTotp.status, 403);

    const enabled = await totp.POST({
      request: post('http://127.0.0.1:4322/api/auth/totp', {}, sessionHeaders),
    });
    const enabledText = await enabled.text();
    assert.equal(enabled.status, 200, enabledText);
    const enabledBody = JSON.parse(enabledText);
    assert.equal(enabledBody.recoveryCodes.length, 8);
    assert.equal(enabledText.includes(process.env.CMS_TOTP_KEY), false);
    assert.equal(enabledText.includes(token), false);

    probe = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'cms', password: 'cms-dev', database: 'cms_authhttp',
    });
    const [[beforeChallenges]] = await probe.query(
      "SELECT COUNT(*) AS n FROM cms_auth_challenges WHERE flow = 'credential'",
    );
    await probe.query(
      'UPDATE cms_auth_sessions SET reauth_at = ? WHERE revoked_at IS NULL',
      [Math.floor(Date.now() / 1000) - 301],
    );
    const stale = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', { step: 'begin' }, sessionHeaders),
    });
    const staleText = await stale.text();
    assert.equal(stale.status, 403, staleText);
    assert.match(staleText, /recent authentication required/);
    const [[afterChallenges]] = await probe.query(
      "SELECT COUNT(*) AS n FROM cms_auth_challenges WHERE flow = 'credential'",
    );
    assert.equal(Number(afterChallenges.n), Number(beforeChallenges.n));

    const reauthBegan = await reauth.POST({
      request: post('http://127.0.0.1:4322/api/auth/reauth', { step: 'begin' }, sessionHeaders),
    });
    const reauthBeganText = await reauthBegan.text();
    assert.equal(reauthBegan.status, 200, reauthBeganText);
    const reauthAssertion = signedAssertion({
      privateKey: keyed.privateKey,
      credentialId: keyed.credentialId,
      challenge: JSON.parse(reauthBeganText).options.challenge,
      counter: 2,
    });
    const reauthDone = await reauth.POST({
      request: post('http://127.0.0.1:4322/api/auth/reauth', {
        step: 'finish', response: reauthAssertion,
      }, sessionHeaders),
    });
    assert.equal(reauthDone.status, 200, await reauthDone.clone().text());

    const secondBegan = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', { step: 'begin' }, sessionHeaders),
    });
    const secondBeganText = await secondBegan.text();
    assert.equal(secondBegan.status, 200, secondBeganText);
    const second = keyedRegistration({ challenge: JSON.parse(secondBeganText).options.challenge });
    const secondDone = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', {
        step: 'finish', response: second.response,
      }, sessionHeaders),
    });
    const secondDoneText = await secondDone.text();
    assert.equal(secondDone.status, 200, secondDoneText);
    const [[credCount]] = await probe.query('SELECT COUNT(*) AS n FROM cms_auth_credentials');
    assert.equal(Number(credCount.n), 2);
    const revoked = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', {
        step: 'revoke', credentialId: JSON.parse(secondDoneText).credentialId,
      }, sessionHeaders),
    });
    assert.equal(revoked.status, 200, await revoked.clone().text());
    const last = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', {
        step: 'revoke', credentialId: keyed.response.id,
      }, sessionHeaders),
    });
    const lastText = await last.text();
    assert.equal(last.status, 409, lastText);
    assert.match(lastText, /last credential stays/);
    const [[stillOne]] = await probe.query('SELECT COUNT(*) AS n FROM cms_auth_credentials');
    assert.equal(Number(stillOne.n), 1);
    const [[audit]] = await probe.query(
      "SELECT detail FROM cms_audit_log WHERE action = 'auth.totp.enable'",
    );
    assert.equal(String(audit.detail).includes(enabledBody.secret), false);

    const allowed = await onRequest({
      ...context,
      request: post('http://127.0.0.1:4322/api/contents/1', { text: 'x', baseRevision: 0 }, sessionHeaders),
    }, async () => new Response('reached'));
    assert.equal(allowed.status, 200);
    const ended = await logout.POST({
      request: post('http://127.0.0.1:4322/api/auth/logout', {}, sessionHeaders),
    });
    assert.equal(ended.status, 200, await ended.clone().text());
    const after = await onRequest({
      ...context,
      request: post('http://127.0.0.1:4322/api/contents/1', { text: 'x', baseRevision: 0 }, sessionHeaders),
    }, async () => new Response('reached'));
    assert.equal(after.status, 401);

    const code = totpAt(base32Decode(enabledBody.secret), Math.floor(Date.now() / 1000));
    const recovered = await recover.POST({
      request: post('http://127.0.0.1:4322/api/auth/recover', {
        code, recoveryCode: enabledBody.recoveryCodes[0],
      }),
    });
    const recoveredText = await recovered.text();
    assert.equal(recovered.status, 200, recoveredText);
    assert.equal(recoveredText.includes(enabledBody.secret), false);
    assert.equal(recoveredText.includes(enabledBody.recoveryCodes[0]), false);
    assert.equal(recoveredText.includes(process.env.CMS_TOTP_KEY), false);
    const rebindCookie = recovered.headers.get('set-cookie');
    assert.match(rebindCookie, /^__Host-cms=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/);
    const rebindHeaders = {
      cookie: rebindCookie.split(';')[0],
      'x-csrf-token': JSON.parse(recoveredText).csrfToken,
    };
    const rebindWrite = await onRequest({
      ...context,
      request: new Request('http://127.0.0.1:4322/api/contents/1', {
        method: 'PUT',
        headers: { origin, 'content-type': 'application/json', ...rebindHeaders },
        body: JSON.stringify({ text: 'x', baseRevision: 0 }),
      }),
    }, async () => new Response('reached'));
    assert.equal(rebindWrite.status, 403);
    assert.equal(await rebindWrite.text(), 'rebind session cannot write');
    const rebindPasskey = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', { step: 'begin' }, rebindHeaders),
    });
    const rebindBeganText = await rebindPasskey.text();
    assert.equal(rebindPasskey.status, 200, rebindBeganText);
    const replacement = keyedRegistration({
      challenge: JSON.parse(rebindBeganText).options.challenge,
    });
    const replaced = await credentials.POST({
      request: post('http://127.0.0.1:4322/api/auth/credentials', {
        step: 'finish', response: replacement.response,
      }, rebindHeaders),
    });
    const replacedText = await replaced.text();
    assert.equal(replaced.status, 200, replacedText);
    const [[left]] = await probe.query('SELECT credential_id FROM cms_auth_credentials');
    assert.equal(left.credential_id, JSON.parse(replacedText).credentialId);
    assert.notEqual(left.credential_id, keyed.response.id);
    const [[rebindSession]] = await probe.query(
      'SELECT credential_id, purpose FROM cms_auth_sessions WHERE revoked_at IS NULL',
    );
    assert.equal(rebindSession.purpose, 'rebind');
    assert.equal(rebindSession.credential_id, left.credential_id);
    const stillBlocked = await onRequest({
      ...context,
      request: new Request('http://127.0.0.1:4322/api/contents/1', {
        method: 'PUT',
        headers: { origin, 'content-type': 'application/json', ...rebindHeaders },
        body: JSON.stringify({ text: 'x', baseRevision: 0 }),
      }),
    }, async () => new Response('reached'));
    assert.equal(stillBlocked.status, 403);
    assert.equal(await stillBlocked.text(), 'rebind session cannot write');
  } finally {
    await probe?.end();
    await closeCmsDb();
  }
});
