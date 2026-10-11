import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const dir = path.resolve(import.meta.dirname, '../docs/cms');
const files = [
  'runbook-cutover.md',
  'runbook-rollback.md',
  'runbook-backup.md',
  'runbook-retire.md',
];

test('CMS runbooks keep production hosts and secrets out of the repo', () => {
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.match(text, /没有在生产执行|没有执行|还没有授权/);
    assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    assert.doesNotMatch(text, /id_rsa|BEGIN OPENSSH|offbox-builder\.env/);
    assert.doesNotMatch(text, /ssh\s+-p\s+\d+/);
  }
});
