import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateRouteId,
  ensureRouteMap,
  normalizeRouteId,
  readPreferredRouteId,
} from './lib/route-allocate.js';

test('chinese titles still fall back to item-{cid}', () => {
  const used = new Set();
  assert.equal(allocateRouteId('中文标题', 88, used), 'item-88');
});

test('typecho slug can pin a new post path', () => {
  const map = {};
  const used = new Set(['omv-webui-400-bad-request']);
  const route = ensureRouteMap(map, {
    cid: 88,
    type: 'post',
    title: '一次中文折腾记录',
    slug: 'pi-notes',
  }, used);
  assert.equal(route.routeId, 'pi-notes');
  assert.equal(route.canonicalPath, '/posts/pi-notes/');
  assert.equal(route.sourceSlug, 'pi-notes');
});

test('numeric or empty Typecho slug is not treated as a manual path', () => {
  assert.equal(normalizeRouteId('88'), null);
  assert.equal(normalizeRouteId(''), null);
  assert.equal(readPreferredRouteId({ slug: '88' }), null);
  const used = new Set();
  const route = ensureRouteMap({}, {
    cid: 88,
    type: 'post',
    title: '一次中文折腾记录',
    slug: '88',
  }, used);
  assert.equal(route.routeId, 'item-88');
});

test('astroPath overrides Typecho slug and title', () => {
  const used = new Set();
  const route = ensureRouteMap({}, {
    cid: 90,
    type: 'post',
    title: 'Hello World',
    slug: 'hello-world',
  }, used, { astroPath: 'manual-path' });
  assert.equal(route.routeId, 'manual-path');
  assert.equal(route.canonicalPath, '/posts/manual-path/');
});

test('invalid astroPath fails instead of falling back', () => {
  assert.throws(
    () => readPreferredRouteId({ astroPath: '你好' }),
    /invalid astroPath/,
  );
  assert.throws(
    () => ensureRouteMap({}, {
      cid: 91,
      type: 'post',
      title: 'Hello',
      slug: 'hello',
    }, new Set(), { astroPath: '你好' }),
    /invalid astroPath/,
  );
});

test('manual path collision fails instead of appending -cid', () => {
  const used = new Set(['pi-notes']);
  assert.throws(
    () => ensureRouteMap({}, {
      cid: 92,
      type: 'post',
      title: '另一篇',
      slug: 'pi-notes',
    }, used),
    /already taken/,
  );
});

test('existing routeIds stay frozen when title and slug change', () => {
  const map = {
    13: {
      kind: 'post',
      routeId: 'maibot-astrbot-napcat',
      canonicalPath: '/posts/maibot-astrbot-napcat/',
      sourceSlug: '13',
      state: 'active',
    },
  };
  const used = new Set(['maibot-astrbot-napcat']);
  const route = ensureRouteMap(map, {
    cid: 13,
    type: 'post',
    title: '新标题',
    slug: 'brand-new-slug',
  }, used, { astroPath: 'should-not-apply' });
  assert.equal(route.routeId, 'maibot-astrbot-napcat');
  assert.equal(route.canonicalPath, '/posts/maibot-astrbot-napcat/');
  assert.equal(route.sourceSlug, 'brand-new-slug');
});

test('pages still refuse default allocation', () => {
  assert.throws(
    () => ensureRouteMap({}, { cid: 2, type: 'page', title: '关于', slug: 'about' }, new Set()),
    /refuse defaulting to post/,
  );
});
