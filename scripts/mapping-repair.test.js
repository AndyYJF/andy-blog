import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DECODED_MAP_LINE,
  ENCODED_MAP_LINE,
  buildExactMappingCandidate,
  validateExactMappingDiff,
} from './validate-1panel-mapping-repair.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('mapping repair accepts only the encoded-to-decoded line replacement', () => {
  const current = `server {\n${ENCODED_MAP_LINE}\n}\n`;
  const candidate = `server {\n${DECODED_MAP_LINE}\n}\n`;
  const result = validateExactMappingDiff(current, candidate);
  assert.equal(result.removed, ENCODED_MAP_LINE);
  assert.equal(result.added, DECODED_MAP_LINE);
  assert.throws(() => validateExactMappingDiff(current, candidate.replace('server {', 'server {\n  add_header X-Drift yes;')));
  assert.throws(() => validateExactMappingDiff(current, current));
  assert.throws(() => validateExactMappingDiff(candidate, candidate));
  assert.equal(buildExactMappingCandidate(current), candidate);
  assert.throws(() => buildExactMappingCandidate(candidate));
});

test('production runner is bounded to 302+enabled and has complete rollback', () => {
  const script = fs.readFileSync(path.join(ROOT, 'host/deploy-mapping-repair-1panel.sh'), 'utf8');
  assert.match(script, /redirect-status.*302/s);
  assert.match(script, /comment-write-mode.*enabled/s);
  assert.match(script, /validate-1panel-mapping-repair\.js/);
  assert.match(script, /--write-candidate "\$CANDIDATE_VHOST"/);
  assert.doesNotMatch(script, /generate-(?:www-cutover-http|1panel-www-nginx)\.js/);
  assert.equal((script.match(/<\/dev\/null/g) || []).length, 2);
  assert.match(script, /openresty.*-t/s);
  assert.match(script, /openresty.*-s.*reload/s);
  assert.match(script, /restore_transaction/);
  assert.match(script, /OLD_BUILDER_IMAGE_ID/);
  assert.match(script, /docker compose -f "\$COMPOSE_FILE" config --images/);
  assert.doesNotMatch(script, /docker compose -f "\$COMPOSE_FILE" images -q builder/);
  assert.match(script, /docker image tag "\$OLD_BUILDER_IMAGE_ID" "\$OLD_BUILDER_IMAGE_REF"/);
  assert.match(script, /rollback incomplete; watcher left stopped/);
  assert.match(script, /REBUILD_PATH_PRESTOPPED/);
  assert.match(script, /OLD_EDGE_PRESENT/);
  assert.match(script, /rm -f -- \/opt\/1panel\/www\/sites\/www\.andy-y\.cn\/deploy\/state\/edge-status/);
  const forwardSwitch = script.indexOf('ln -sfn "releases/$RELEASE_ID"');
  assert.ok(
    script.indexOf('SYMLINK_SWITCHED=1', forwardSwitch)
      < script.indexOf('mv -T "$WWW_ROOT/previous.next"', forwardSwitch),
    'rollback must become active before the first symlink replacement',
  );
  assert.doesNotMatch(script, /redirect-status 301|transition-deploy-state|cdn-purge|docker compose.*nginx|POST /i);
});
