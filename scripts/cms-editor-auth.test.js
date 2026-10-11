import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CSRF_STORAGE_KEY,
  editorWriteHeaders,
  forgetCsrf,
  readStoredCsrf,
  rememberCsrf,
} from '../cms/src/lib/editor-auth.js';

test('the editor save header carries the stored CSRF token and nothing else', () => {
  const storage = new Map();
  const memory = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  assert.deepEqual(editorWriteHeaders(''), { 'content-type': 'application/json' });
  assert.equal(rememberCsrf(memory, 'csrf-token'), true);
  assert.equal(readStoredCsrf(memory), 'csrf-token');
  assert.deepEqual(editorWriteHeaders(readStoredCsrf(memory)), {
    'content-type': 'application/json',
    'x-csrf-token': 'csrf-token',
  });
  assert.equal(storage.get(CSRF_STORAGE_KEY), 'csrf-token');
  forgetCsrf(memory);
  assert.equal(readStoredCsrf(memory), '');
  assert.equal(rememberCsrf(memory, ''), false);
});
