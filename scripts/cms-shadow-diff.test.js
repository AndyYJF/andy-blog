import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'cms-shadow-diff.js');
const fixture = path.resolve(root, 'docs/cms/fixtures/migration/positive');
const snapshot = path.resolve(root, 'docs/cms/fixtures/build/snapshot-1700000001.json');

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

function writeTree(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

function baseArgs(markdownA, markdownB) {
  const manifest = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-shadow-manifest-'));
  writeTree(manifest, { 'i18n-selection.json': '{"snapshotEpoch":1700000001}\n' });
  return [
    '--private', fixture, fixture,
    '--snapshot', snapshot, snapshot,
    '--markdown', markdownA, markdownB,
    '--manifest', manifest, manifest,
  ];
}

test('shadow diff stops before dist and reports a markdown change', () => {
  assert.equal(fs.readFileSync(script).includes(13), false);
  const usage = run([]);
  assert.equal(usage.status, 64);

  const markdown = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-shadow-md-'));
  writeTree(path.join(markdown, 'a'), { 'posts/one.md': 'same\n' });
  writeTree(path.join(markdown, 'b'), { 'posts/one.md': 'same\n' });
  const stopped = run(baseArgs(path.join(markdown, 'a'), path.join(markdown, 'b')));
  assert.equal(stopped.status, 65, stopped.stderr);
  const stoppedReport = JSON.parse(stopped.stdout);
  assert.equal(stoppedReport.equal, false);
  assert.equal(stoppedReport.complete, false);
  assert.equal(stoppedReport.stages.private.equal, true);
  assert.equal(stoppedReport.stages.snapshot.equal, true);
  assert.equal(stoppedReport.stages.markdown.equal, true);
  assert.equal(stoppedReport.stages.manifest.equal, true);
  assert.equal(stoppedReport.stages.dist.compared, false);
  assert.equal(stoppedReport.stages.dist.reason, 'dist was not built');

  writeTree(path.join(markdown, 'c'), { 'posts/one.md': 'changed\n' });
  const changed = run(baseArgs(path.join(markdown, 'a'), path.join(markdown, 'c')));
  assert.equal(changed.status, 1, changed.stderr);
  const changedReport = JSON.parse(changed.stdout);
  assert.equal(changedReport.stages.markdown.equal, false);
  assert.equal(changedReport.stages.dist.compared, false);

  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-shadow-dist-'));
  writeTree(path.join(dist, 'a'), { 'index.html': 'fixture\n' });
  writeTree(path.join(dist, 'b'), { 'index.html': 'fixture\n' });
  const complete = run([
    ...baseArgs(path.join(markdown, 'a'), path.join(markdown, 'b')),
    '--dist', path.join(dist, 'a'), path.join(dist, 'b'),
  ]);
  assert.equal(complete.status, 0, complete.stderr);
  const completeReport = JSON.parse(complete.stdout);
  assert.equal(completeReport.equal, true);
  assert.equal(completeReport.stages.dist.compared, true);
});
