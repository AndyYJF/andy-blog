import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureMomentRouteMap,
  ensureRouteMap,
  FIELD_CONTENT_KIND,
} from './lib/route-allocate.js';

test('moments allocate /moments/<cid>/ and freeze on re-sync', () => {
  const map = {};
  const used = new Set(['omv-webui-400-bad-request']);
  const first = ensureMomentRouteMap(map, {
    cid: 90,
    type: 'post',
    title: '闲话草稿标题',
    slug: '90',
  }, used);
  assert.equal(first.kind, 'moment');
  assert.equal(first.routeId, '90');
  assert.equal(first.canonicalPath, '/moments/90/');
  assert.equal(first.commentKey, '/moments/90/');
  assert.equal(first.feedGuid, 'urn:andy-y:moment:90');

  const second = ensureMomentRouteMap(map, {
    cid: 90,
    type: 'post',
    title: '改过的管理标题',
    slug: 'moment-90',
  }, used);
  assert.equal(second.routeId, '90');
  assert.equal(second.canonicalPath, '/moments/90/');
  assert.equal(second.sourceSlug, 'moment-90');
});

test('withdrawn moment tombstone can republish under the same cid', () => {
  const map = {
    90: {
      kind: 'moment',
      routeId: '90',
      canonicalPath: '/moments/90/',
      commentKey: '/moments/90/',
      feedGuid: 'urn:andy-y:moment:90',
      legacyPaths: [],
      state: 'tombstone',
      disposition: 'withdrawn',
      sourceSlug: '90',
    },
  };
  const used = new Set();
  const restored = ensureMomentRouteMap(map, {
    cid: 90,
    type: 'post',
    title: '再次公开',
    slug: '90',
  }, used);
  assert.equal(restored.state, 'active');
  assert.equal(restored.canonicalPath, '/moments/90/');
  assert.equal(restored.commentKey, '/moments/90/');
  assert.equal(restored.feedGuid, 'urn:andy-y:moment:90');
  assert.equal(restored.disposition, undefined);
  assert.equal(used.has('90'), true);
});

test('permanently deleted moment tombstone refuses revive', () => {
  const map = {
    91: {
      kind: 'moment',
      routeId: '91',
      canonicalPath: '/moments/91/',
      state: 'tombstone',
      disposition: 'gone',
    },
  };
  assert.throws(
    () => ensureMomentRouteMap(map, { cid: 91, type: 'post', title: 'x', slug: '91' }, new Set()),
    /permanently deleted/,
  );
});

test('refuse converting an existing post into a moment', () => {
  const map = {
    13: {
      kind: 'post',
      routeId: 'maibot-astrbot-napcat',
      canonicalPath: '/posts/maibot-astrbot-napcat/',
      state: 'active',
    },
  };
  assert.throws(
    () => ensureMomentRouteMap(map, { cid: 13, type: 'post', title: 'x', slug: '13' }, new Set()),
    /refuse converting to moment/,
  );
});

test('refuse converting an existing moment into a post', () => {
  const map = {
    90: {
      kind: 'moment',
      routeId: '90',
      canonicalPath: '/moments/90/',
      state: 'active',
    },
  };
  assert.throws(
    () => ensureRouteMap(map, { cid: 90, type: 'post', title: 'x', slug: '90' }, new Set()),
    /refuse converting to post/,
  );
});

test('FIELD_CONTENT_KIND constant is stable for Typecho fields', () => {
  assert.equal(FIELD_CONTENT_KIND, 'content_kind');
});
