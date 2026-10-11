import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cmsContentSecurityPolicy, hashesFromPolicy } from '../cms/src/lib/csp.js';
import { onRequest } from '../cms/src/middleware.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function policyOf(kind, extra = {}) {
  return cmsContentSecurityPolicy({ kind, ...extra });
}

test('the CMS policy names script, style, frame, image, and connect sources without copying the public site policy', () => {
  const app = policyOf('app', { scriptHashes: ["'sha256-abc'"], styleHashes: ["'sha256-def'"], nonce: 'noncevalue' });
  for (const name of ['script-src', 'style-src', 'frame-src', 'img-src', 'connect-src']) {
    assert.match(app, new RegExp(`${name} `));
  }
  assert.match(app, /script-src 'self' 'sha256-abc' 'nonce-noncevalue'/);
  assert.match(app, /style-src 'self' 'sha256-def' 'nonce-noncevalue'/);
  assert.match(app, /script-src-attr 'none'/);
  assert.match(app, /style-src-attr 'none'/);
  assert.match(app, /frame-src 'self'/);
  assert.match(app, /frame-ancestors 'self'/);
  assert.match(app, /connect-src 'self'/);
  assert.match(app, /img-src 'self' data: blob:/);
  assert.doesNotMatch(app, /https:/);
  assert.doesNotMatch(app, /unsafe-inline|wasm-unsafe-eval|umami\.andy-y\.cn|ipwho\.is|player\.bilibili\.com|music\.163\.com/);

  const preview = policyOf('preview', { nonce: 'noncevalue' });
  assert.match(preview, /img-src 'self' data: blob: https:/);
  assert.match(preview, /frame-src 'self' https:\/\/player\.bilibili\.com https:\/\/music\.163\.com/);
  assert.doesNotMatch(preview, /unsafe-inline|umami\.andy-y\.cn|wasm-unsafe-eval/);

  const api = policyOf('api', { nonce: 'noncevalue', scriptHashes: ["'sha256-abc'"] });
  assert.match(api, /default-src 'none'/);
  assert.doesNotMatch(api, /noncevalue|sha256-abc/);
});

test('middleware keeps Astro hashes and uses a different frame rule for the preview document', async () => {
  const context = {
    clientAddress: '127.0.0.1',
    request: new Request('http://127.0.0.1:4322/edit/1/'),
    locals: {},
  };
  const response = await onRequest(context, async () => new Response('<html></html>', {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; script-src 'self' 'sha256-fromastro'; style-src-elem 'self' 'sha256-stylehash';",
    },
  }));
  const policy = response.headers.get('content-security-policy');
  assert.equal(context.locals.cspNonce.length > 0, true);
  assert.match(policy, /'sha256-fromastro'/);
  assert.match(policy, /'sha256-stylehash'/);
  assert.equal(policy.includes(`'nonce-${context.locals.cspNonce}'`), true);
  assert.doesNotMatch(policy, /player\.bilibili\.com/);
  assert.equal(hashesFromPolicy(policy, 'script-src').includes("'sha256-fromastro'"), true);

  const preview = await onRequest({
    clientAddress: '127.0.0.1',
    request: new Request('http://127.0.0.1:4322/preview-frame/?flow=1'),
    locals: {},
  }, async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
  assert.match(preview.headers.get('content-security-policy'), /player\.bilibili\.com/);
  assert.match(preview.headers.get('content-security-policy'), /https:/);

  const api = await onRequest({
    clientAddress: '127.0.0.1',
    request: new Request('http://127.0.0.1:4322/api/preview', { method: 'GET' }),
    locals: {},
  }, async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  assert.match(api.headers.get('content-security-policy'), /default-src 'none'/);
});

test('the preview iframe stays opaque and the OpenResty sample does not send the public CSP', () => {
  const frame = fs.readFileSync(path.join(ROOT, 'cms/src/pages/edit/[cid].astro'), 'utf8');
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frame, /allow-same-origin/);
  const out = path.join(os.tmpdir(), `cms-nginx-csp-${process.pid}.conf`);
  execFileSync(process.execPath, ['scripts/generate-1panel-cms-nginx.js', '--out', out], { cwd: ROOT });
  const conf = fs.readFileSync(out, 'utf8');
  fs.rmSync(out, { force: true });
  assert.match(conf, /Do not add the www Content-Security-Policy/);
  assert.doesNotMatch(conf, /add_header Content-Security-Policy|umami\.andy-y\.cn|wasm-unsafe-eval/);
});
