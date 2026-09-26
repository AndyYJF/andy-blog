import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimInvite,
  createChallengeStore,
  hashPow,
  meetsDifficulty,
  readInviteConfig,
  verifyPow,
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
    LINUXDO_INVITE_URL: 'https://linux.do/invites/envOnly',
    LINUXDO_POW_DIFFICULTY: '9',
  });
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

test('challenge + claim flow', async () => {
  const store = createChallengeStore({ ttlMs: 60_000 });
  const server = createServer({
    challengeStore: store,
    readInviteConfig: () => ({
      inviteUrl: 'https://linux.do/invites/unitTest',
      note: 'n',
      difficulty: 2,
    }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const opt = await fetch(`http://127.0.0.1:${port}/linuxdo/challenge`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://www.andy-y.cn' },
    });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), 'https://www.andy-y.cn');

    const chRes = await fetch(`http://127.0.0.1:${port}/linuxdo/challenge`, {
      headers: { Origin: 'https://www.andy-y.cn' },
    });
    assert.equal(chRes.status, 200);
    assert.equal(chRes.headers.get('access-control-allow-origin'), 'https://www.andy-y.cn');
    const ch = await chRes.json();
    assert.equal(ch.ok, true);
    assert.equal(ch.difficulty, 2);

    let nonce = 0;
    while (!meetsDifficulty(hashPow(ch.salt, String(nonce)), ch.difficulty)) nonce += 1;

    const bad = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ch.id, nonce: String(nonce + 1) }),
    });
    assert.equal(bad.status, 403);

    const ok = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.andy-y.cn' },
      body: JSON.stringify({ id: ch.id, nonce: String(nonce) }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      ok: true,
      inviteUrl: 'https://linux.do/invites/unitTest',
      note: 'n',
    });

    const reuse = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ch.id, nonce: String(nonce) }),
    });
    assert.equal(reuse.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
