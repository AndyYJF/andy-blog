import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { claimInvite, readInviteConfig, verifyTurnstile } from './lib.js';
import { createServer } from './server.js';

test('claimInvite accepts linux.do invite URLs only', () => {
  assert.deepEqual(claimInvite({ inviteUrl: 'https://linux.do/invites/abc_12-Z', note: 'hi' }), {
    ok: true,
    inviteUrl: 'https://linux.do/invites/abc_12-Z',
    note: 'hi',
  });
  assert.throws(() => claimInvite({ inviteUrl: 'https://evil.example/invites/x' }), /invalid invite url/);
});

test('readInviteConfig merges env file', () => {
  const cfg = readInviteConfig({
    TURNSTILE_SECRET_KEY: 'from-env',
    LINUXDO_INVITE_URL: 'https://linux.do/invites/envOnly',
  });
  assert.equal(cfg.secret, 'from-env');
  assert.equal(cfg.inviteUrl, 'https://linux.do/invites/envOnly');
});

test('verifyTurnstile posts to siteverify', async () => {
  let saw = null;
  const ok = await verifyTurnstile({
    secret: 'sec',
    token: 'tok',
    ip: '1.2.3.4',
    fetchImpl: async (url, init) => {
      saw = { url, body: String(init.body) };
      return {
        ok: true,
        async json() {
          return { success: true };
        },
      };
    },
  });
  assert.equal(ok, true);
  assert.equal(saw.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.match(saw.body, /secret=sec/);
  assert.match(saw.body, /response=tok/);
  assert.match(saw.body, /remoteip=1\.2\.3\.4/);
});

test('claim endpoint requires turnstile then returns invite', async () => {
  const server = createServer({
    readInviteConfig: () => ({
      secret: 'sec',
      inviteUrl: 'https://linux.do/invites/unitTest',
      note: 'n',
    }),
    verifyTurnstile: async () => true,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(missing.status, 400);

    const ok = await fetch(`http://127.0.0.1:${port}/linuxdo/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: 'tok' }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      ok: true,
      inviteUrl: 'https://linux.do/invites/unitTest',
      note: 'n',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
