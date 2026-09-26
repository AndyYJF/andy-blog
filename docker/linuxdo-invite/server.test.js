import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimInvite,
  createChallengeStore,
  hashPow,
  meetsDifficulty,
  readInviteConfig,
  verifyPow,
  verifyTurnstile,
} from './lib.js';
import { createServer } from './server.js';

test('claimInvite accepts linux.do invite URLs only', () => {
  assert.deepEqual(claimInvite({ inviteUrl: 'https://linux.do/invites/abc_12-Z', note: 'hi' }), {
    ok: true,
    inviteUrl: 'https://linux.do/invites/abc_12-Z',
    note: 'hi',
  });
  assert.throws(() => claimInvite({ inviteUrl: 'https://evil.example/invites/x' }), /invalid invite url/);
});

test('readInviteConfig reads invite fields and clamps difficulty', () => {
  const cfg = readInviteConfig({
    TURNSTILE_SECRET_KEY: 'sec',
    LINUXDO_INVITE_URL: 'https://linux.do/invites/envOnly',
    LINUXDO_POW_DIFFICULTY: '9',
  });
  assert.equal(cfg.secret, 'sec');
  assert.equal(cfg.inviteUrl, 'https://linux.do/invites/envOnly');
  assert.equal(cfg.difficulty, 6);
});

test('verifyPow checks leading zero hex difficulty', () => {
  const salt = 'abc';
  let nonce = 0;
  while (!meetsDifficulty(hashPow(salt, String(nonce)), 2)) nonce += 1;
  assert.equal(verifyPow({ salt, nonce, difficulty: 2 }), true);
  assert.equal(verifyPow({ salt, nonce: nonce + 1, difficulty: 2 }), false);
});

test('verifyTurnstile accepts LINUXDO_CLAIM_DEV token', async () => {
  const prev = process.env.LINUXDO_CLAIM_DEV;
  process.env.LINUXDO_CLAIM_DEV = '1';
  try {
    assert.equal(await verifyTurnstile({ secret: 'x', token: 'dev-ok' }), true);
    assert.equal(await verifyTurnstile({ secret: 'x', token: 'nope' }), false);
  } finally {
    if (prev === undefined) delete process.env.LINUXDO_CLAIM_DEV;
    else process.env.LINUXDO_CLAIM_DEV = prev;
  }
});

test('challenge + claim requires turnstile then pow', async () => {
  const store = createChallengeStore({ ttlMs: 60_000 });
  let verified = 0;
  const server = createServer({
    challengeStore: store,
    readInviteConfig: () => ({
      secret: 'unit-secret',
      inviteUrl: 'https://linux.do/invites/unitTest',
      note: 'n',
      difficulty: 2,
    }),
    verifyTurnstile: async ({ token }) => {
      verified += 1;
      return token === 'ok-token';
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const chRes = await fetch(`http://127.0.0.1:${port}/linuxdo/challenge`, {
      headers: { Origin: 'https://www.andy-y.cn' },
    });
    assert.equal(chRes.status, 200);
    const ch = await chRes.json();
    assert.equal(ch.ok, true);

    let nonce = 0;
    while (!meetsDifficulty(hashPow(ch.salt, String(nonce)), ch.difficulty)) nonce += 1;

    const missingTs = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ch.id, nonce: String(nonce) }),
    });
    assert.equal(missingTs.status, 400);
    assert.equal((await missingTs.json()).error, 'missing_token');

    const badTs = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ch.id, nonce: String(nonce), turnstileToken: 'bad' }),
    });
    assert.equal(badTs.status, 403);
    assert.equal((await badTs.json()).error, 'turnstile_failed');

    const ok = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.andy-y.cn' },
      body: JSON.stringify({ id: ch.id, nonce: String(nonce), turnstileToken: 'ok-token' }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      ok: true,
      inviteUrl: 'https://linux.do/invites/unitTest',
      note: 'n',
    });
    assert.equal(verified, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
