import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWriteLimiter, rateLimitKey, refuseWriteRate } from '../cms/src/lib/rate-limit.js';

test('forwarded addresses do not choose the rate-limit key unless the peer is the loopback proxy', () => {
  const spoofed = { realIp: '203.0.113.8', forwardedFor: '203.0.113.9, 203.0.113.10' };
  assert.equal(rateLimitKey({ peer: '127.0.0.1', ...spoofed, trustedProxy: '' }), '127.0.0.1');
  assert.equal(rateLimitKey({ peer: '127.0.0.1', ...spoofed, trustedProxy: '203.0.113.1' }), '127.0.0.1');
  assert.equal(rateLimitKey({ peer: '10.0.0.4', ...spoofed, trustedProxy: '127.0.0.1' }), '10.0.0.4');
  assert.equal(
    rateLimitKey({ peer: '127.0.0.1', ...spoofed, trustedProxy: '::ffff:127.0.0.1' }),
    '203.0.113.10',
  );
});

test('writes past the local ceiling are refused and reads are not counted', () => {
  const limiter = createWriteLimiter({ limit: 2, windowMs: 10_000 });
  const base = { peer: '127.0.0.1', trustedProxy: '', limiter, now: 1_000 };
  assert.equal(refuseWriteRate({ ...base, method: 'PUT' }), null);
  assert.equal(refuseWriteRate({ ...base, method: 'POST' }), null);
  const blocked = refuseWriteRate({ ...base, method: 'DELETE' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfter, 10);
  assert.equal(refuseWriteRate({ ...base, method: 'GET' }), null);
  assert.equal(refuseWriteRate({ ...base, method: 'PUT', peer: '::1' }), null);
});

test('the CMS OpenResty sample limits writes by the direct connection', () => {
  const out = path.join(os.tmpdir(), `cms-nginx-${process.pid}.conf`);
  execFileSync(process.execPath, ['scripts/generate-1panel-cms-nginx.js', '--out', out], {
    cwd: path.resolve(import.meta.dirname, '..'),
  });
  const conf = fs.readFileSync(out, 'utf8');
  fs.rmSync(out, { force: true });
  assert.match(conf, /limit_req_zone \$cms_write_key zone=cms_write:1m rate=4r\/s;/);
  assert.match(conf, /POST \$binary_remote_addr;/);
  assert.match(conf, /limit_req zone=cms_write burst=20 nodelay;/);
  assert.match(conf, /limit_req_status 429;/);
  assert.doesNotMatch(conf, /\$http_x_forwarded_for|\$http_x_real_ip/);
});
