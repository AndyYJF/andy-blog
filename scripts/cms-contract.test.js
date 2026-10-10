import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareDistDirs,
  refreshMigrationChecksums,
  validateBuildSnapshot,
  validateMigrationPackage,
} from './lib/cms-contract.js';
import { positiveBuildSnapshot, writePositiveMigrationPackage, writeSanitizedFixtures } from './lib/cms-contract-samples.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = path.join(ROOT, 'docs', 'baselines', 'fixtures');
const node = process.execPath;

function run(script, args, env = {}) {
  return spawnSync(node, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('sanitized build snapshot accepts a draft pointer that is absent from versions', () => {
  const errors = validateBuildSnapshot(positiveBuildSnapshot());
  assert.deepEqual(errors, []);
});

test('negative build snapshots fail for duplicate keys, wrong types, and unapproved bodies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-build-'));
  writeSanitizedFixtures(dir);
  assert.equal(run('validate-snapshot.js', [path.join(dir, 'build', 'snapshot-1700000001.json')]).status, 0);
  const duplicate = run('validate-snapshot.js', [path.join(dir, 'build', 'snapshot-1700000002-duplicate-cid.json')]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /duplicate primary key/);
  const wrongType = run('validate-snapshot.js', [path.join(dir, 'build', 'snapshot-1700000003-string-cid.json')]);
  assert.equal(wrongType.status, 1);
  assert.match(wrongType.stderr, /safe integer/);
  const unapproved = run('validate-snapshot.js', [path.join(dir, 'build', 'snapshot-1700000004-unapproved-body.json')]);
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.stderr, /draft_version_id/);
  const before = hashFile(path.join(dir, 'build', 'snapshot-1700000003-string-cid.json'));
  run('validate-snapshot.js', [path.join(dir, 'build', 'snapshot-1700000003-string-cid.json')]);
  assert.equal(hashFile(path.join(dir, 'build', 'snapshot-1700000003-string-cid.json')), before);
});

test('legacy fixtures upgrade in place-preserving reports and stay byte-identical', () => {
  const cases = [
    ['snapshot-1785565762.json', 2],
    ['snapshot-1786673780.json', 0],
  ];
  for (const [name, filtered] of cases) {
    const input = path.join(FIXTURES, name);
    const before = hashFile(input);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-legacy-'));
    const output = path.join(outDir, name);
    const result = run('normalize-legacy-snapshot.js', [input, output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(hashFile(input), before);
    const report = JSON.parse(fs.readFileSync(output.replace(/\.json$/, '.upgrade-report.json'), 'utf8'));
    assert.equal(report.recognizedAs, 'legacy-export-without-schemaVersion');
    assert.equal(report.filteredRows.length, filtered);
    assert.equal(report.i18n, 'absent; pre-i18n sample, i18n key not invented');
    assert.equal(report.migrationComplete, false);
    assert.equal(run('validate-snapshot.js', [output]).status, 0);
    const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
    assert.equal(raw.schemaVersion, undefined);
  }
  const rejected = run('normalize-legacy-snapshot.js', [path.join(ROOT, 'package.json'), path.join(os.tmpdir(), 'snapshot-nope.json')]);
  assert.equal(rejected.status, 64);
});

test('snapshot compare reports value, type, missing row, and duplicate key changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-compare-'));
  const base = path.join(dir, 'snapshot-base.json');
  const same = path.join(dir, 'snapshot-same.json');
  const value = path.join(dir, 'snapshot-value.json');
  const type = path.join(dir, 'snapshot-type.json');
  const missing = path.join(dir, 'snapshot-missing.json');
  const duplicate = path.join(dir, 'snapshot-duplicate.json');
  const snapshot = positiveBuildSnapshot();
  fs.writeFileSync(base, `${JSON.stringify(snapshot)}\n`);
  fs.writeFileSync(same, `${JSON.stringify(snapshot)}\n`);
  const changed = structuredClone(snapshot);
  changed.contents[1].title = '改过的标题';
  fs.writeFileSync(value, `${JSON.stringify(changed)}\n`);
  const typed = structuredClone(snapshot);
  typed.contents[1].allowComment = 1;
  fs.writeFileSync(type, `${JSON.stringify(typed)}\n`);
  const dropped = structuredClone(snapshot);
  dropped.contents.pop();
  fs.writeFileSync(missing, `${JSON.stringify(dropped)}\n`);
  const dup = structuredClone(snapshot);
  dup.contents.push({ ...dup.contents[0] });
  fs.writeFileSync(duplicate, `${JSON.stringify(dup)}\n`);

  assert.equal(run('compare-snapshots.js', [base, same]).status, 0);
  const valueReport = JSON.parse(run('compare-snapshots.js', [base, value]).stdout);
  assert.equal(valueReport.equal, false);
  assert.ok(valueReport.differences.some((diff) => diff.kind === 'value' && diff.field === 'title'));
  const typeReport = JSON.parse(run('compare-snapshots.js', [base, type]).stdout);
  assert.ok(typeReport.differences.some((diff) => diff.kind === 'type' && diff.field === 'allowComment'));
  const missingReport = JSON.parse(run('compare-snapshots.js', [base, missing]).stdout);
  assert.ok(missingReport.differences.some((diff) => diff.kind === 'missing'));
  const duplicateReport = JSON.parse(run('compare-snapshots.js', [base, duplicate]).stdout);
  assert.ok(duplicateReport.duplicateKeys.length > 0);
  assert.notEqual(run('compare-snapshots.js', [base, duplicate]).status, 0);
});

test('private package accepts full i18n rows and rejects dangling pointers and tampered bodies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-pkg-'));
  const positive = path.join(dir, 'positive');
  writePositiveMigrationPackage(positive);
  assert.deepEqual(validateMigrationPackage(positive), []);
  assert.equal(run('validate-migration-package.js', [positive]).status, 0);
  assert.equal(run('compare-migration-state.js', [positive, positive]).status, 0);

  const dangling = path.join(dir, 'dangling');
  fs.cpSync(positive, dangling, { recursive: true });
  const heads = JSON.parse(fs.readFileSync(path.join(dangling, 'tables', 'i18n_translation_head.json'), 'utf8'));
  heads[0].draft_version_id = 99;
  fs.writeFileSync(path.join(dangling, 'tables', 'i18n_translation_head.json'), `${JSON.stringify(heads)}\n`);
  refreshMigrationChecksums(dangling);
  const danglingRun = run('validate-migration-package.js', [dangling]);
  assert.equal(danglingRun.status, 1);
  assert.match(danglingRun.stderr, /draft_version_id 99/);

  const tampered = path.join(dir, 'tampered');
  fs.cpSync(positive, tampered, { recursive: true });
  const versions = JSON.parse(fs.readFileSync(path.join(tampered, 'tables', 'i18n_translation_version.json'), 'utf8'));
  versions[1].body = 'Tampered\n';
  fs.writeFileSync(path.join(tampered, 'tables', 'i18n_translation_version.json'), `${JSON.stringify(versions)}\n`);
  refreshMigrationChecksums(tampered);
  const tamperedRun = run('validate-migration-package.js', [tampered]);
  assert.equal(tamperedRun.status, 1);
  assert.match(tamperedRun.stderr, /content_digest/);

  const leased = path.join(dir, 'leased-cleared');
  fs.cpSync(positive, leased, { recursive: true });
  const jobs = JSON.parse(fs.readFileSync(path.join(leased, 'tables', 'i18n_translation_job.json'), 'utf8'));
  const leasedJob = jobs.find((row) => row.status === 'leased');
  leasedJob.status = 'queued';
  leasedJob.lease_owner = null;
  leasedJob.lease_until = null;
  fs.writeFileSync(path.join(leased, 'tables', 'i18n_translation_job.json'), `${JSON.stringify(jobs)}\n`);
  refreshMigrationChecksums(leased);
  assert.notEqual(run('compare-migration-state.js', [positive, leased]).status, 0);
  const allowed = run('compare-migration-state.js', [positive, leased, '--allow-controlled-runtime']);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  const allowedReport = JSON.parse(allowed.stdout);
  assert.ok(allowedReport.controlledRuntimeDifferences.some((diff) => diff.field === 'status'));

  const title = path.join(dir, 'title');
  fs.cpSync(positive, title, { recursive: true });
  const contents = JSON.parse(fs.readFileSync(path.join(title, 'tables', 'contents.json'), 'utf8'));
  contents[1].title = '另一篇';
  fs.writeFileSync(path.join(title, 'tables', 'contents.json'), `${JSON.stringify(contents)}\n`);
  refreshMigrationChecksums(title);
  assert.notEqual(run('compare-migration-state.js', [positive, title, '--allow-controlled-runtime']).status, 0);
});

test('dist compare shows hash and missing files, and prints normalization rules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-dist-'));
  const a = path.join(dir, 'a');
  const b = path.join(dir, 'b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'index.html'), 'same');
  fs.writeFileSync(path.join(b, 'index.html'), 'same');
  fs.writeFileSync(path.join(a, 'app.js'), 'one');
  fs.writeFileSync(path.join(b, 'app.js'), 'two');
  fs.writeFileSync(path.join(a, 'only-a.txt'), 'x');
  const rules = path.join(dir, 'rules.json');
  fs.writeFileSync(rules, `${JSON.stringify({ rules: [{ path: 'app.js', reason: 'synthetic cache id' }] })}\n`);
  const plain = JSON.parse(run('compare-dist.js', [a, b]).stdout);
  assert.equal(plain.equal, false);
  assert.ok(plain.hashDifferences.some((diff) => diff.path === 'app.js'));
  assert.ok(plain.missing.some((diff) => diff.path === 'only-a.txt'));
  const normalized = JSON.parse(run('compare-dist.js', [a, b, '--normalize', rules]).stdout);
  assert.equal(normalized.equal, false);
  assert.equal(normalized.normalizedDifferences[0].rule, 'synthetic cache id');
  assert.equal(normalized.normalizedDifferences[0].a.length, 64);
  fs.writeFileSync(path.join(b, 'only-a.txt'), 'x');
  fs.writeFileSync(path.join(b, 'app.js'), 'one');
  assert.equal(compareDistDirs(a, b).equal, true);
});

test('committed sanitized fixtures match the generator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-fixtures-'));
  writeSanitizedFixtures(dir);
  const committed = path.join(ROOT, 'docs', 'cms', 'fixtures');
  for (const name of ['build', 'migration']) {
    const report = compareDistDirs(path.join(dir, name), path.join(committed, name));
    assert.equal(report.equal, true, JSON.stringify(report));
  }
});

test('sync still reads a legacy fixture without schemaVersion and does not write route maps', () => {
  const sync = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-typecho.js'), 'utf8');
  assert.doesNotMatch(sync, /schemaVersion/);
  assert.doesNotMatch(sync, /validate-snapshot|validate-migration-package/);
  const route = hashFile(path.join(ROOT, 'data', 'route-map.json'));
  const meta = hashFile(path.join(ROOT, 'data', 'meta-route-map.json'));
  const baseEnv = { ...process.env };
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT']) delete baseEnv[key];
  const runSync = (epoch, file, dir) => spawnSync(node, [path.join(ROOT, 'scripts', 'sync-typecho.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      SNAPSHOT_EPOCH: epoch,
      FIXTURE_PATH: path.join(FIXTURES, file),
      CONTENT_BACKUP_DIR: dir,
    },
  });
  const blocked = runSync('1785565762', 'snapshot-1785565762.json', path.join(os.tmpdir(), `cms-backup-old-${process.pid}`));
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /cid=9001 moment was permanently deleted/);
  assert.doesNotMatch(blocked.stderr, /schemaVersion/);

  const first = path.join(os.tmpdir(), `cms-backup-a-${process.pid}`);
  const second = path.join(os.tmpdir(), `cms-backup-b-${process.pid}`);
  const a = runSync('1786673780', 'snapshot-1786673780.json', first);
  const b = runSync('1786673780', 'snapshot-1786673780.json', second);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(hashFile(path.join(ROOT, 'data', 'route-map.json')), route);
  assert.equal(hashFile(path.join(ROOT, 'data', 'meta-route-map.json')), meta);
  const compared = compareDistDirs(first, second);
  assert.equal(compared.equal, true, JSON.stringify(compared));
  assert.ok(fs.existsSync(path.join(first, 'posts')));
});
