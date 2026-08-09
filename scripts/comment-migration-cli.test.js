import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseArgs,
  reportFromResult,
  validateExternalFilePaths,
} from './migrate-comments-mysql.js';

test('CLI parser rejects unknown, duplicate, and missing options', () => {
  assert.throws(() => parseArgs(['--unknown']), /unknown option/);
  assert.throws(() => parseArgs(['--source']), /missing value/);
  assert.throws(() => parseArgs(['--twice', '--twice']), /duplicate option/);
  assert.deepEqual(
    parseArgs(['--source', '/tmp/source.json', '--report', '/tmp/report.json', '--twice']),
    { '--source': '/tmp/source.json', '--report': '/tmp/report.json', '--twice': true },
  );
});

test('source and report paths must be external, absolute, and non-overwriting', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-comment-cli-'));
  const source = path.join(directory, 'source.json');
  const report = path.join(directory, 'report.json');
  fs.writeFileSync(source, '[]\n', { mode: 0o600 });
  assert.doesNotThrow(() => validateExternalFilePaths(source, report));
  assert.throws(() => validateExternalFilePaths('relative.json', report), /absolute path/);
  fs.writeFileSync(report, '{}\n', { mode: 0o600 });
  assert.throws(() => validateExternalFilePaths(source, report), /already exists/);
});

test('migration report retains deletion-review IDs but no source PII or paths', () => {
  const emptyPass = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    insertedLegacyCoids: [],
    updatedLegacyCoids: [],
    deletedLegacyCoids: [43],
    pendingAbsentLegacyCoids: [42],
    repairedDrift: [],
  };
  const reconciliation = {
    ok: true,
    sourceSelected: 0,
    mappings: 0,
    mappedComments: 0,
    nativeWalineComments: 0,
    missingMappings: [],
    extraMappings: [],
    missingComments: [],
    duplicateWalineIds: [],
    sourceHashMismatches: [],
    commentMismatches: [],
  };
  const report = reportFromResult({
    database: 'waline',
    sourceSha256: 'a'.repeat(64),
    result: {
      sourceCounts: { source: 0, selected: 0, archived: 0, approved: 0, waiting: 0, spam: 0 },
      mode: 'dry-run',
      applySweep: false,
      committed: false,
      ok: true,
      blockers: [],
      first: emptyPass,
      second: emptyPass,
      secondNoop: true,
      reconciliation,
    },
  });
  const serialized = JSON.stringify(report);
  for (const forbidden of ['secret body text', 'person@example.com', '192.0.2.1', '/root/private/source.json']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(report.privacy.startsWith('counts/hashes plus pending/deleted legacy_coid'), true);
  assert.deepEqual(report.first.pendingAbsentLegacyCoids.legacyCoids, [42]);
  assert.deepEqual(report.first.deletedLegacyCoids.legacyCoids, [43]);
});
