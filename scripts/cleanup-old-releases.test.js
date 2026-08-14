import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupOldReleases } from './cleanup-old-releases.js';

const IDS = [
  '20260801T000000Z-00000001',
  '20260802T000000Z-00000002',
  '20260803T000000Z-00000003',
  '20260804T000000Z-00000004',
  '20260805T000000Z-00000005',
  '20260806T000000Z-00000006',
  '20260807T000000Z-00000007',
];

function symlinkRelease(deployRoot, marker, releaseId) {
  const target = process.platform === 'win32'
    ? path.join(deployRoot, 'releases', releaseId)
    : path.join('releases', releaseId);
  fs.symlinkSync(target, path.join(deployRoot, marker), process.platform === 'win32' ? 'junction' : 'dir');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-blog-retention-'));
  const deployRoot = path.join(root, 'deploy');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(path.join(deployRoot, 'releases'), { recursive: true });
  fs.mkdirSync(stateDir);
  for (const releaseId of IDS) {
    const releaseDir = path.join(deployRoot, 'releases', releaseId);
    fs.mkdirSync(releaseDir);
    fs.writeFileSync(path.join(releaseDir, 'payload.txt'), releaseId);
  }
  symlinkRelease(deployRoot, 'current', IDS[6]);
  symlinkRelease(deployRoot, 'previous', IDS[5]);
  fs.writeFileSync(path.join(stateDir, 'last-success-release'), `${IDS[1]}\n`);
  return { root, deployRoot, stateDir };
}

function releaseExists(deployRoot, releaseId) {
  return fs.existsSync(path.join(deployRoot, 'releases', releaseId));
}

test('keeps newest releases plus current, previous, and an older last-success marker', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const result = cleanupOldReleases({
    ...data,
    activeRelease: IDS[6],
    keep: 3,
    stagingMaxAgeHours: 24,
  });
  assert.deepEqual(result.deletedReleases, [IDS[0], IDS[2], IDS[3]]);
  for (const releaseId of [IDS[1], IDS[4], IDS[5], IDS[6]]) {
    assert.equal(releaseExists(data.deployRoot, releaseId), true, `${releaseId} must be retained`);
  }
  assert.equal(result.reclaimedBytes > 0, true);
});

test('dry-run reports candidates without deleting them', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const result = cleanupOldReleases({
    ...data,
    activeRelease: IDS[6],
    keep: 3,
    stagingMaxAgeHours: 24,
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.deletedReleases.length, 3);
  assert.equal(IDS.every((releaseId) => releaseExists(data.deployRoot, releaseId)), true);
});

test('removes only stale, validated staging directories', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const oldStage = `.${IDS[0]}.staging`;
  const freshStage = `.${IDS[3]}.staging`;
  for (const name of [oldStage, freshStage]) {
    const stageDir = path.join(data.deployRoot, 'releases', name);
    fs.mkdirSync(stageDir);
    fs.writeFileSync(path.join(stageDir, 'payload.txt'), name);
  }
  const nowMs = Date.UTC(2026, 7, 13, 12, 0, 0);
  fs.utimesSync(
    path.join(data.deployRoot, 'releases', oldStage),
    new Date(nowMs - 48 * 60 * 60 * 1000),
    new Date(nowMs - 48 * 60 * 60 * 1000),
  );
  fs.utimesSync(
    path.join(data.deployRoot, 'releases', freshStage),
    new Date(nowMs - 2 * 60 * 60 * 1000),
    new Date(nowMs - 2 * 60 * 60 * 1000),
  );
  const result = cleanupOldReleases({
    ...data,
    activeRelease: IDS[6],
    keep: 7,
    stagingMaxAgeHours: 24,
    nowMs,
  });
  assert.deepEqual(result.deletedStaging, [oldStage]);
  assert.equal(fs.existsSync(path.join(data.deployRoot, 'releases', oldStage)), false);
  assert.equal(fs.existsSync(path.join(data.deployRoot, 'releases', freshStage)), true);
});

test('fails closed when current does not match the active release', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  assert.throws(() => cleanupOldReleases({
    ...data,
    activeRelease: IDS[5],
    keep: 3,
    stagingMaxAgeHours: 24,
  }), /active release does not match current marker/);
  assert.equal(IDS.every((releaseId) => releaseExists(data.deployRoot, releaseId)), true);
});

test('refuses a marker that resolves outside releases', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.unlinkSync(path.join(data.deployRoot, 'previous'));
  const outside = path.join(data.root, IDS[5]);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(data.deployRoot, 'previous'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => cleanupOldReleases({
    ...data,
    activeRelease: IDS[6],
    keep: 3,
    stagingMaxAgeHours: 24,
  }), /previous target escapes releases/);
  assert.equal(IDS.every((releaseId) => releaseExists(data.deployRoot, releaseId)), true);
});
