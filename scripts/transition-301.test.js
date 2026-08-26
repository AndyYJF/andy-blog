import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  LEGACY_PATH_FROM,
  LEGACY_PATH_TO,
  LEGACY_QUERY_FROM,
  LEGACY_QUERY_TO,
  assertExactLegacy301Flip,
  flipLegacyReturns302to301,
} from './flip-1panel-legacy-status.js';

test('legacy query returns are rewritten before path returns', () => {
  const current = `  ${LEGACY_QUERY_FROM};\n  ${LEGACY_PATH_FROM};\n  return 301 https://www.andy-y.cn$request_uri;\n`;
  const expected = `  ${LEGACY_QUERY_TO};\n  ${LEGACY_PATH_TO};\n  return 301 https://www.andy-y.cn$request_uri;\n`;
  assert.equal(flipLegacyReturns302to301(current), expected);
  assert.deepEqual(assertExactLegacy301Flip(current, expected), { ok: true, queryHits: 1, pathHits: 1 });
  assert.throws(() => flipLegacyReturns302to301(expected), /missing 302/);
  assert.throws(() => assertExactLegacy301Flip(current, `${expected} # drift\n`), /exact 302->301/);
});

test('301 transition runner is a bounded 1Panel vhost transaction', () => {
  const script = fs.readFileSync(new URL('../host/transition-301-1panel.sh', import.meta.url), 'utf8');
  assert.match(script, /EXPECTED_CURRENT_ID/);
  assert.match(script, /20260819T083006Z-96a161e2/);
  assert.match(script, /20260819T062045Z-b962d863/);
  assert.match(script, /flip-1panel-legacy-status\.js/);
  assert.match(script, /materialize-301-release\.js/);
  assert.match(script, /compare-nginx-policy\.js/);
  assert.match(script, /--status-flip-301/);
  assert.match(script, /openresty.*-t/s);
  assert.match(script, /openresty.*-s.*reload/s);
  assert.match(script, /restore_transaction/);
  assert.match(script, /redirect-status.*301/s);
  assert.match(script, /comment-write-mode.*enabled/s);
  assert.match(script, /cdn-purge\.sh/);
  assert.doesNotMatch(script, /purge_everything|whole-zone|transition-deploy-state/);
  assert.doesNotMatch(script, /docker compose.*nginx/);
  const forwardSwitch = script.indexOf('ln -sfn "releases/$NEW_ID"');
  assert.ok(forwardSwitch !== -1);
  assert.ok(
    script.indexOf('SYMLINK_SWITCHED=1', forwardSwitch) !== -1
      && script.indexOf('SYMLINK_SWITCHED=1', forwardSwitch)
        < script.indexOf('mv -T "$WWW_ROOT/current.next"', forwardSwitch),
    'rollback must become active before current symlink replacement',
  );
});
