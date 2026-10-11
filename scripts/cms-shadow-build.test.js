import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'cms-shadow-build.sh');
const fixture = path.join(root, 'docs', 'baselines', 'fixtures', 'snapshot-1786673780.json');

function unixPath(file) {
  const result = spawnSync('bash', ['-lc', 'cygpath -u "$1"', 'bash', path.resolve(file)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function run(env) {
  return spawnSync('bash', ['-lc', 'exec bash scripts/cms-shadow-build.sh'], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('shadow build stays outside the repository and does not build dist', () => {
  const text = fs.readFileSync(script, 'utf8');
  assert.equal(text.includes('\r'), false);
  assert.doesNotMatch(text, /switch-release|cdn-purge|blog-rebuild/);

  const route = path.join(root, 'data', 'route-map.json');
  const meta = path.join(root, 'data', 'meta-route-map.json');
  const routeBefore = hash(route);
  const metaBefore = hash(meta);

  const refused = run({
    SHADOW_WORK: unixPath(root),
    SNAPSHOT_EPOCH: '1786673780',
    FIXTURE_PATH: unixPath(fixture),
  });
  assert.equal(refused.status, 65, refused.stderr);
  assert.match(refused.stderr, /refuses the repository worktree/);

  const missing = run({ SHADOW_WORK: unixPath(os.tmpdir()) });
  assert.equal(missing.status, 64, missing.stderr);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-shadow-build-'));
  const built = run({
    SHADOW_WORK: unixPath(work),
    SNAPSHOT_EPOCH: '1786673780',
    FIXTURE_PATH: unixPath(fixture),
  });
  assert.equal(built.status, 65, built.stderr);
  assert.match(built.stderr, /shadow dist was not built/);
  assert.equal(fs.existsSync(path.join(work, 'content', 'posts')), true);
  const selection = JSON.parse(fs.readFileSync(path.join(work, 'content', 'manifests', 'i18n-selection.json'), 'utf8'));
  assert.equal(selection.snapshotEpoch, 1786673780);
  assert.equal(hash(route), routeBefore);
  assert.equal(hash(meta), metaBefore);
  assert.equal(fs.existsSync(path.join(root, 'astro', 'dist')), false);
});
