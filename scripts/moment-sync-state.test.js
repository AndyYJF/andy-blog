import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPurgePlan, CDN_PURGE_SITE, verifyPurgePlan } from './cdn-purge-core.js';
import { collectMomentPaths, listMomentPagePathsFromSite } from './generate-cdn-purge-plan.js';
import {
  momentDispositionForMissingPublic,
  SNAPSHOT_CONTENT_TYPES,
  SNAPSHOT_CONTENT_TYPES_SQL,
} from './lib/moment-sync-state.js';
import { ensureMomentRouteMap, FIELD_CONTENT_KIND } from './lib/route-allocate.js';

test('snapshot SQL includes post_draft for disposition', () => {
  const exportSrc = fs.readFileSync(new URL('./export-typecho-snapshot.js', import.meta.url), 'utf8');
  const syncSrc = fs.readFileSync(new URL('./sync-typecho.js', import.meta.url), 'utf8');
  assert.match(exportSrc, /post_draft/);
  assert.match(syncSrc, /post_draft/);
  assert.deepEqual(SNAPSHOT_CONTENT_TYPES, ['post', 'page', 'post_draft']);
  assert.match(SNAPSHOT_CONTENT_TYPES_SQL, /post_draft/);
});

test('R01: post_draft moment in snapshot becomes withdrawn not gone', () => {
  const fields = [{ cid: 95, name: FIELD_CONTENT_KIND, str_value: 'moment' }];
  const draftRow = { cid: 95, type: 'post_draft', title: 'x', status: 'publish' };
  const contentKind = fields.find((f) => f.cid === 95)?.str_value;
  assert.equal(
    momentDispositionForMissingPublic({ row: draftRow, contentKind }),
    'withdrawn',
  );
  assert.equal(
    momentDispositionForMissingPublic({ row: null, contentKind: 'moment' }),
    'gone',
  );

  // Simulate sync: active → missing public with draft still in snapshot → republish OK
  const map = {
    95: {
      kind: 'moment',
      routeId: '95',
      canonicalPath: '/moments/95/',
      commentKey: '/moments/95/',
      feedGuid: 'urn:andy-y:moment:95',
      legacyPaths: [],
      state: 'active',
      sourceSlug: '95',
    },
  };
  map[95].state = 'tombstone';
  map[95].disposition = momentDispositionForMissingPublic({
    row: draftRow,
    contentKind: 'moment',
  });
  assert.equal(map[95].disposition, 'withdrawn');
  const restored = ensureMomentRouteMap(map, {
    cid: 95,
    type: 'post',
    title: 'back',
    slug: '95',
  }, new Set());
  assert.equal(restored.state, 'active');
  assert.equal(restored.canonicalPath, '/moments/95/');
});

test('R03: purge plan unions previous /moments/page/N/ with current lastmod', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moments-purge-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  // Current sync: only page 1 remains in lastmod (16→15 style shrink)
  fs.writeFileSync(
    path.join(dataDir, 'lastmod.json'),
    JSON.stringify({ '/moments/': '2026-09-08', '/moments/page/1/': '2026-09-08' }),
  );
  fs.writeFileSync(path.join(dataDir, 'route-map.json'), JSON.stringify({
    90: { kind: 'moment', canonicalPath: '/moments/90/', state: 'active' },
  }));

  const www = path.join(root, 'www');
  const prevPages = path.join(www, 'current', 'site', 'moments', 'page');
  fs.mkdirSync(path.join(prevPages, '2'), { recursive: true });
  fs.writeFileSync(path.join(prevPages, '2', 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(prevPages, '1'), { recursive: true });
  fs.writeFileSync(path.join(prevPages, '1', 'index.html'), '<html></html>');

  assert.deepEqual(listMomentPagePathsFromSite(path.join(www, 'current', 'site')).sort(), [
    '/moments/page/1/',
    '/moments/page/2/',
  ]);

  const paths = collectMomentPaths({ root, wwwRoot: www });
  assert.ok(paths.includes('/moments/page/2/'), 'stale page 2 must be purged');
  assert.ok(paths.includes('/moments/page/1/'));
  assert.ok(paths.includes('/moments/90/'));

  const plan = createPurgePlan({
    releaseId: '20260908T120000Z-abcd1234',
    legacy: [{ oldPath: '/legacy/', action: 'redirect', targetPath: '/posts/x/' }],
    extraPaths: paths,
  });
  verifyPurgePlan(plan, '20260908T120000Z-abcd1234');
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/page/2/`));
});
