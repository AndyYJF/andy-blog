import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLOSED_KEY, OPEN_KEY, EXPECTED_POLICY_ENTRIES, validatePolicy, validateRelease,
} from './phase9c-validate-release.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function makeRelease() {
  const releaseId = '20260809T120000Z-deadbeef';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9c-release-'));
  const entries = {
    [CLOSED_KEY]: { writable: false, kind: 'post', routeId: '47' },
    [OPEN_KEY]: { writable: true, kind: 'post', routeId: '62' },
  };
  for (let index = 0; index < EXPECTED_POLICY_ENTRIES - 2; index += 1) {
    entries[`/posts/phase9c-fixture-${index}/`] = { writable: true, kind: 'post', routeId: `f${index}` };
  }
  write(path.join(root, 'manifest.json'), `${JSON.stringify({
    releaseId, redirectStatus: 302, commentWriteMode: 'enabled', productionWriteEnabled: true,
  })}\n`);
  write(path.join(root, 'comment-policy.json'), `${JSON.stringify({ writeEnabled: true, entries })}\n`);
  write(path.join(root, 'site/release-id.txt'), `${releaseId}\n`);
  write(path.join(root, 'site/index.html'), '<!doctype html>\n');
  write(path.join(root, 'nginx/release-http.conf'), 'return 302 /target;\n');
  const relativeFiles = [
    'comment-policy.json', 'manifest.json', 'nginx/release-http.conf',
    'site/index.html', 'site/release-id.txt',
  ];
  write(path.join(root, 'checksums.sha256'), relativeFiles
    .map((relative) => `${sha(fs.readFileSync(path.join(root, relative)))}  ${relative}`)
    .join('\n').concat('\n'));
  return { root, releaseId, entries };
}

test('Phase 9c validator requires 302 + enabled and one exact closed key', () => {
  const fixture = makeRelease();
  const result = validateRelease({ releaseDir: fixture.root, releaseId: fixture.releaseId });
  assert.equal(result.policy.entries, 15);
  assert.equal(result.policy.writable, 14);
  assert.deepEqual(result.policy.closed, [CLOSED_KEY]);
  const checksumsPath = path.join(fixture.root, 'checksums.sha256');
  fs.writeFileSync(checksumsPath, fs.readFileSync(checksumsPath, 'utf8').replaceAll('  ', ' *'));
  assert.equal(validateRelease({ releaseDir: fixture.root, releaseId: fixture.releaseId }).policy.entries, 15);
  fs.writeFileSync(checksumsPath, fs.readFileSync(checksumsPath, 'utf8').replaceAll(' *', ' *./'));
  assert.equal(validateRelease({ releaseDir: fixture.root, releaseId: fixture.releaseId }).policy.entries, 15);
  fs.appendFileSync(checksumsPath, fs.readFileSync(checksumsPath, 'utf8').split('\n')[0].replace(' *./', ' *').concat('\n'));
  assert.throws(
    () => validateRelease({ releaseDir: fixture.root, releaseId: fixture.releaseId }),
    /bad checksum line/,
  );
  assert.throws(() => validatePolicy({
    writeEnabled: true,
    entries: { ...fixture.entries, [CLOSED_KEY]: { writable: true } },
  }), /closed comment keys drifted/);
  assert.throws(() => validatePolicy({ writeEnabled: false, entries: fixture.entries }), /not globally enabled/);
});

test('1Panel enable runner preserves topology and uses controlled state transitions', () => {
  const script = fs.readFileSync(path.join(ROOT, 'host/enable-production-comments-1panel.sh'), 'utf8');
  assert.match(script, /transition_script" comment-write-mode enabled/);
  assert.match(script, /transition_script" comment-write-mode disabled/);
  assert.match(script, /cmp -s "\$deploy_root\/current\/nginx\/release-http\.conf"/);
  assert.match(script, /closed_status.*403/s);
  assert.match(script, /entry-not-writable/);
  assert.match(script, /unknown-key/);
  assert.match(script, /native_probe_rows=1/);
  assert.match(script, /PHASE9C_RESUME_EVIDENCE_DIR/);
  assert.match(script, /probe_mode='retained-from-prior-evidence'/);
  assert.match(script, /resume marker row mismatch/);
  assert.match(script, /resume release checksum manifest mismatch/);
  assert.match(script, /evidence_ready='false'/);
  assert.match(script, /test "\$evidence_ready" = 'true'/);
  assert.match(script, /phase9c-validate-release\.mjs/);
  assert.doesNotMatch(script, /docker compose|cdn-purge|redirect-status 301|openresty.+reload|waline_staging/i);
});

test('Phase 9c builder is fixed to 302 + enabled and an external artifact path', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts/build-1panel-comment-enable-release.sh'), 'utf8');
  assert.match(script, /REDIRECT_STATUS='302' COMMENT_WRITE_MODE='enabled'/);
  assert.match(script, /generate-nginx\.js --status 302/);
  assert.match(script, /finalize-manifest\.js[\s\\]+[\s\S]*--redirect-status 302 --comment-write-mode enabled/);
  assert.match(script, /PHASE9C_OUTPUT_DIR must be outside repository/);
  assert.match(script, /phase9c-validate-release\.mjs/);
  assert.match(script, /worktree must be clean, including untracked files/);
  assert.match(script, /migration_fixture_epoch='1785565762'/);
  assert.match(script, /build_drift.*diff --name-only/s);
  assert.match(script, /astro\/src\/generated\/release-state\.ts/);
  assert.match(script, /nginx\/release-manifest\.json/);
  assert.match(script, /git show HEAD:host\/transition-deploy-state\.sh/);
  assert.match(script, /git -C "\$root" status --porcelain\)"/);
  assert.doesNotMatch(script, /--status 301|redirect-status 301/);
});
