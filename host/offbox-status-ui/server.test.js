import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createServer, resetLoginRateLimitsForTests } from './server.js';

function request(port, urlPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function cookieHeader(setCookie) {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const pair = String(raw || '').split(';', 1)[0];
  return pair;
}

test('offbox status ui server', async (t) => {
  const runtime = await fsp.mkdtemp(path.join(os.tmpdir(), 'offbox-status-'));
  const passwordFile = path.join(runtime, 'password');
  const password = 'test-pass-value';
  await fsp.writeFile(passwordFile, `${password}\n`, { encoding: 'utf8', mode: 0o600 });

  process.env.STATUS_UI_PASSWORD_FILE = passwordFile;
  process.env.OFFBOX_STATUS_RUNTIME = runtime;
  process.env.OFFBOX_STATUS_BIND = '127.0.0.1';
  delete process.env.STATUS_UI_USER;
  delete process.env.ALLOW_NO_AUTH;
  resetLoginRateLimitsForTests();

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(runtime, { recursive: true, force: true });
    resetLoginRateLimitsForTests();
  });

  await t.test('unsigned /api/status returns 401 without HTTP Basic', async () => {
    const res = await request(port, '/api/status');
    assert.equal(res.status, 401);
    assert.equal(res.headers['www-authenticate'], undefined);
    assert.doesNotMatch(res.body, /DB_PASSWORD/);
  });

  await t.test('GET / is the ledger password page without a session', async () => {
    const res = await request(port, '/');
    assert.equal(res.status, 200);
    assert.match(res.body, /login-form/);
    assert.match(res.body, /ledger-btn/);
    assert.match(res.body, /请输入密码/);
    assert.match(res.body, /app\.css/);
    assert.doesNotMatch(res.body, /www-authenticate|Basic realm|weui-btn/);
  });

  await t.test('login stylesheet is public', async () => {
    const res = await request(port, '/app.css');
    assert.equal(res.status, 200);
    assert.match(res.body, /--amber/);
  });

  await t.test('HTTP Basic does not unlock /api/status', async () => {
    const res = await request(port, '/api/status', {
      headers: {
        authorization: `Basic ${Buffer.from(`andy:${password}`).toString('base64')}`,
      },
    });
    assert.equal(res.status, 401);
  });

  await t.test('/healthz is 200 without auth and does not leak progress', async () => {
    const res = await request(port, '/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    assert.doesNotMatch(res.body, /tail|releaseId|progress/i);
  });

  await t.test('wrong password stays unauthorized', async () => {
    resetLoginRateLimitsForTests();
    const res = await request(port, '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  await t.test('authed /api/status redacts secrets in the log tail', async () => {
    resetLoginRateLimitsForTests();
    await fsp.writeFile(
      path.join(runtime, 'progress.json'),
      `${JSON.stringify({
        status: 'running',
        phase: 'astro',
        builder: 'offbox',
        releaseId: 'rel-1',
        current: 'rel-1',
        previous: 'rel-0',
        startedAt: '2026-08-19T00:00:00Z',
        updatedAt: '2026-08-19T00:01:00Z',
        error: null,
        steps: [{ id: 'astro', label: 'Astro / mermaid', state: 'running' }],
      })}\n`,
      'utf8',
    );
    await fsp.writeFile(
      path.join(runtime, 'progress.log'),
      'PROGRESS astro\nDB_PASSWORD=secret\nok line\n',
      'utf8',
    );

    const login = await request(port, '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 204);
    const cookie = cookieHeader(login.headers['set-cookie']);
    assert.match(cookie, /^offbox_sid=/);
    assert.match(String(login.headers['set-cookie']), /HttpOnly/i);
    assert.doesNotMatch(String(login.headers['set-cookie']), /password/i);

    const res = await request(port, '/api/status', {
      headers: { cookie },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'running');
    assert.equal(body.phase, 'astro');
    assert.ok(Array.isArray(body.tail));
    assert.ok(body.tail.includes('[redacted]'));
    assert.ok(body.tail.includes('PROGRESS astro'));
    assert.ok(!body.tail.some((line) => String(line).includes('secret')));
    assert.doesNotMatch(res.body, /DB_PASSWORD=secret/);
    assert.equal(body.steps[0].id, 'astro');
    assert.equal(body.steps[0].state, 'running');
    assert.equal(body.lastOutcome, null);
    assert.equal(body.retryMax, 3);

    const home = await request(port, '/', { headers: { cookie } });
    assert.equal(home.status, 200);
    assert.match(home.body, /构建状态/);
    assert.doesNotMatch(home.body, /login-form|ledger-btn/);
    assert.match(home.body, /href="\/history"/);
  });

  await t.test('history page and api list completed builds', async () => {
    resetLoginRateLimitsForTests();
    await fsp.writeFile(
      path.join(runtime, 'history.jsonl'),
      `${JSON.stringify({
        status: 'failed',
        finishedAt: '2026-08-19T03:17:25Z',
        phase: 'astro',
        error: 'rebuild exited 65',
        retryCount: 1,
        retryMax: 3,
      })}\n${JSON.stringify({
        status: 'success',
        finishedAt: '2026-08-19T03:20:00Z',
        releaseId: 'rel-2',
        phase: 'done',
        retryCount: 0,
        retryMax: 3,
      })}\n`,
      'utf8',
    );
    const login = await request(port, '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const cookie = cookieHeader(login.headers['set-cookie']);
    const unsigned = await request(port, '/api/history');
    assert.equal(unsigned.status, 401);
    const res = await request(port, '/api/history', { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.items[0].status, 'success');
    assert.equal(body.items[1].status, 'failed');
    assert.equal(body.items[1].phase, 'astro');
    const page = await request(port, '/history', { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.body, /构建历史/);
    assert.match(page.body, /history\.js/);
  });

  await t.test('path traversal does not return server source', async () => {
    resetLoginRateLimitsForTests();
    const login = await request(port, '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const cookie = cookieHeader(login.headers['set-cookie']);
    const paths = ['/api/../server.js', '/%2e%2e/server.js'];
    for (const urlPath of paths) {
      const res = await request(port, urlPath, { headers: { cookie } });
      assert.equal(res.status, 404, urlPath);
      assert.doesNotMatch(res.body, /createServer/);
      assert.doesNotMatch(res.body, /STATUS_UI_PASSWORD_FILE/);
      assert.doesNotMatch(res.body, /import crypto/);
    }
  });

  await t.test('repeated failed logins are rate limited with 429', async () => {
    resetLoginRateLimitsForTests();
    let last = null;
    for (let i = 0; i < 5; i++) {
      last = await request(port, '/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'nope' }),
      });
      assert.ok(last.status === 401 || last.status === 429, `attempt ${i + 1}: ${last.status}`);
    }
    assert.equal(last.status, 429);
    assert.deepEqual(JSON.parse(last.body), { error: 'rate_limited' });
    const again = await request(port, '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(again.status, 429);
    assert.deepEqual(JSON.parse(again.body), { error: 'rate_limited' });
  });
});

test('fail-closed when password is not configured', async (t) => {
  const runtime = await fsp.mkdtemp(path.join(os.tmpdir(), 'offbox-status-noauth-'));
  const prevPasswordFile = process.env.STATUS_UI_PASSWORD_FILE;
  const prevAllow = process.env.ALLOW_NO_AUTH;

  process.env.OFFBOX_STATUS_RUNTIME = runtime;
  process.env.OFFBOX_STATUS_BIND = '127.0.0.1';
  delete process.env.STATUS_UI_PASSWORD_FILE;
  delete process.env.ALLOW_NO_AUTH;
  resetLoginRateLimitsForTests();

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(runtime, { recursive: true, force: true });
    if (prevPasswordFile == null) delete process.env.STATUS_UI_PASSWORD_FILE;
    else process.env.STATUS_UI_PASSWORD_FILE = prevPasswordFile;
    if (prevAllow == null) delete process.env.ALLOW_NO_AUTH;
    else process.env.ALLOW_NO_AUTH = prevAllow;
    resetLoginRateLimitsForTests();
  });

  const res = await request(port, '/api/status');
  assert.ok(res.status === 401 || res.status === 503);
  assert.notEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.error === 'unauthorized' || body.error === 'auth_not_configured');

  const health = await request(port, '/healthz');
  assert.equal(health.status, 200);
});
