import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const script = path.join(ROOT, 'scripts', 'export-typecho-snapshot.js');

test('Typecho snapshot export is fail-closed without epoch or destination', () => {
  const bytes = fs.readFileSync(script);
  assert.equal(bytes.includes(13), false, 'export-typecho-snapshot.js must use LF');
  assert.match(bytes.toString('utf8'), /EXPORT_SNAPSHOT_JSON/);
  assert.doesNotMatch(bytes.toString('utf8'), /from ['"]astro['"]|playwright install/i);

  const missingEpoch = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, EXPORT_SNAPSHOT_JSON: '/runtime/build/snapshot-export.json' },
    encoding: 'utf8',
  });
  assert.equal(missingEpoch.status, 64);

  const missingOut = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, SNAPSHOT_EPOCH: '1770000000' },
    encoding: 'utf8',
  });
  assert.equal(missingOut.status, 64);

  const relativeOut = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env: {
      ...process.env,
      SNAPSHOT_EPOCH: '1770000000',
      EXPORT_SNAPSHOT_JSON: 'snapshot.json',
    },
    encoding: 'utf8',
  });
  assert.equal(relativeOut.status, 64);
});
