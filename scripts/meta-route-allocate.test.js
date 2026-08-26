import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { profile } from '../astro/src/data/profile.ts';
import { ensureMetaRouteMap } from './lib/meta-route-allocate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('SITE card points at the Astro category canonical, not /posts/', () => {
  const site = profile.projects.find((item) => item.marker === 'SITE');
  assert.ok(site);
  assert.equal(site.linkLabel, '浏览相关文章');
  assert.equal(site.href, '/category/astro/');
  assert.notEqual(site.href, '/posts/astro/');
  assert.notEqual(site.href, '/category/Astro');
  assert.notEqual(site.href, '/category/Astro/');
  assert.match(site.href, /^\/category\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/);
});

test('existing fixture metas keep committed category/tag routeIds', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs/baselines/fixtures/snapshot-1786673780.json'), 'utf8'),
  );
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/meta-route-map.json'), 'utf8'));
  const next = structuredClone(committed);
  ensureMetaRouteMap(next, fixture.metas);

  for (const [mid, entry] of Object.entries(committed)) {
    assert.equal(next[mid].routeId, entry.routeId, `routeId drifted for mid=${mid}`);
    assert.equal(next[mid].canonicalPath, entry.canonicalPath, `canonical drifted for mid=${mid}`);
    assert.equal(next[mid].type, entry.type);
  }
  assert.equal(Object.keys(next).length, Object.keys(committed).length);
});

test('a new Typecho Astro category allocates /category/astro/ from slug Astro', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/meta-route-map.json'), 'utf8'));
  assert.equal(
    Object.values(committed).some((entry) => entry.type === 'category' && entry.routeId === 'astro'),
    false,
    'local map must not hard-code a fake Astro category',
  );

  const next = structuredClone(committed);
  ensureMetaRouteMap(next, [
    { mid: 16, name: 'Astro', slug: 'Astro', type: 'category' },
  ]);

  const created = next['16'];
  assert.equal(created.type, 'category');
  assert.equal(created.routeId, 'astro');
  assert.equal(created.canonicalPath, '/category/astro/');
  assert.equal(created.sourceSlug, 'Astro');
  assert.equal(created.state, 'active');
  assert.deepEqual(created.legacyPaths, [
    '/index.php/category/Astro/',
    '/category/Astro/',
  ]);
});

test('lowercase Typecho slug still canonicalizes to /category/astro/', () => {
  const next = {};
  ensureMetaRouteMap(next, [{ mid: 16, name: 'Astro', slug: 'astro', type: 'category' }]);
  assert.equal(next['16'].canonicalPath, '/category/astro/');
  assert.equal(next['16'].routeId, 'astro');
});
