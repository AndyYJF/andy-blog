import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeNginxUriKey} from './nginx-uri.js';

test('nginx URI keys decode committed percent-encoded UTF-8 paths', () => {
  assert.equal(normalizeNginxUriKey('/index.php/tag/%E5%88%86%E6%9E%90fen-x/'),'/index.php/tag/分析fen-x/');
  assert.equal(normalizeNginxUriKey('/archives/47/'),'/archives/47/');
});

test('nginx URI key normalization rejects malformed and unsafe input', () => {
  assert.throws(() => normalizeNginxUriKey('relative'),/invalid nginx URI key/);
  assert.throws(() => normalizeNginxUriKey('/bad%ZZ'),/invalid percent encoding/);
  assert.throws(() => normalizeNginxUriKey('/bad%0Apath'),/unsafe nginx URI key/);
});
