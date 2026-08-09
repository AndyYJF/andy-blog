import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../host/install-typecho-comment-readonly-guard.sh', import.meta.url));
const script = fs.readFileSync(scriptPath, 'utf8');

test('guard installer creates exact permanent insert update delete guards', () => {
  for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.match(script, new RegExp(`BEFORE ${event} ON`));
    assert.match(script, new RegExp(`expect_blocked '${event}'`));
  }
  assert.equal((script.match(/CREATE TRIGGER/g) || []).length, 3);
  assert.match(script, /TYPECHO_COMMENTS_READ_ONLY_AFTER_ASTRO_CUTOVER/);
});

test('guard installer preserves authoring and requires backups plus disabled state', () => {
  assert.match(script, /typecho-before\.sql\.gz/);
  assert.match(script, /waline-before\.sql\.gz/);
  assert.match(script, /state\/redirect-status/);
  assert.match(script, /state\/comment-write-mode/);
  assert.match(script, /allow_comment_sha256/);
  assert.doesNotMatch(script, /UPDATE\s+typecho_contents|DELETE\s+FROM\s+typecho_contents/i);
  assert.doesNotMatch(script, /docker\s+(stop|restart)\b|docker compose\s+.*\bup\b/i);
});

test('failure rollback can only drop the three named triggers', () => {
  assert.match(script, /rollback_guard_on_exit/);
  assert.equal((script.match(/DROP TRIGGER IF EXISTS/g) || []).length, 1);
  assert.doesNotMatch(script, /DROP\s+(TABLE|DATABASE)/i);
  assert.match(script, /created_insert='false'/);
  assert.match(script, /created_update='false'/);
  assert.match(script, /created_delete='false'/);
});
