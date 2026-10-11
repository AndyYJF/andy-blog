import assert from 'node:assert/strict';
import test from 'node:test';
import { crossOriginWriteRefusal } from '../cms/src/middleware.js';

function request(method, origin) {
  return new Request('http://127.0.0.1:4322/api/contents/1', {
    method,
    headers: origin ? { origin } : {},
  });
}

test('a write from another origin is refused and a same-origin write is allowed', () => {
  assert.equal(crossOriginWriteRefusal(request('PUT', 'https://evil.example')), 'cross-origin write refused');
  assert.equal(crossOriginWriteRefusal(request('POST', 'http://127.0.0.1:9999')), 'cross-origin write refused');
  assert.equal(crossOriginWriteRefusal(request('PUT', 'null')), 'cross-origin write refused');
  assert.equal(crossOriginWriteRefusal(request('PUT', 'http://127.0.0.1:4322')), null);
  assert.equal(crossOriginWriteRefusal(new Request('http://localhost:4322/api/contents/1', {
    method: 'PUT',
    headers: { origin: 'http://127.0.0.1:4322' },
  })), null);
  assert.equal(crossOriginWriteRefusal(request('PUT', 'http://localhost:4322')), 'cross-origin write refused');
  assert.equal(crossOriginWriteRefusal(request('PUT')), null);
  assert.equal(crossOriginWriteRefusal(request('GET', 'https://evil.example')), null);
});
