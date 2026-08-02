/**
 * Unit tests for comment-policy middleware helpers.
 */
import assert from 'node:assert/strict';
import {
  authorizeCommentWrite,
  extractPathFromBody,
  normalizeCommentPath,
} from './policy.js';

assert.equal(normalizeCommentPath('/posts/foo'), '/posts/foo/');
assert.equal(normalizeCommentPath('/posts/foo/'), '/posts/foo/');
assert.equal(normalizeCommentPath('posts/foo'), '/posts/foo/');
assert.equal(normalizeCommentPath('https://evil.example/'), null);
assert.equal(normalizeCommentPath('/posts/../etc/'), null);
assert.equal(normalizeCommentPath('/posts//foo/'), '/posts/foo/');

assert.equal(extractPathFromBody({ url: '/posts/x' }), '/posts/x/');
assert.equal(extractPathFromBody({ path: '/about' }), '/about/');

const policy = {
  writeEnabled: false,
  entries: {
    '/posts/a/': { writable: true },
    '/posts/b/': { writable: false },
  },
};

assert.equal(authorizeCommentWrite(policy, 'GET', '/posts/a/').ok, true);
assert.equal(authorizeCommentWrite(policy, 'POST', '/posts/a/').ok, false);
assert.equal(authorizeCommentWrite(policy, 'POST', '/posts/a/').reason, 'writeEnabled=false');

policy.writeEnabled = true;
assert.equal(authorizeCommentWrite(policy, 'POST', '/posts/a/').ok, true);
assert.equal(authorizeCommentWrite(policy, 'POST', '/posts/b/').ok, false);
assert.equal(authorizeCommentWrite(policy, 'POST', '/posts/b/').reason, 'entry-not-writable');
assert.equal(authorizeCommentWrite(policy, 'POST', '/posts/missing/').ok, false);
assert.equal(authorizeCommentWrite(policy, 'POST', null).reason, 'missing-or-invalid-path');

import { isApiPath, isCommentWritePath } from './server-path.js';

assert.equal(isCommentWritePath('/api/comment'), true);
assert.equal(isCommentWritePath('/api/comment/'), true);
assert.equal(isCommentWritePath('/api/comment/reply'), true);
assert.equal(isCommentWritePath('/api/comment?x=1'), false); // pathname never includes query
assert.equal(isCommentWritePath('/api/user'), false);
assert.equal(isApiPath('/api/user'), true);
assert.equal(isApiPath('/ui/login'), false);

console.log(JSON.stringify({ ok: true, tests: 19 }));
