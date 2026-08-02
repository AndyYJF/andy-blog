/**
 * Behavioral mutations for Stage4 regex-self and Stage8 reviewKind (AA-13/AA-14).
 * Runs against copies under a temp dir where possible; for nginx/reviews it
 * mutates then restores files in-repo under try/finally.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NGINX = path.join(ROOT, 'nginx/release-http.conf');
const REVIEW11 = path.join(ROOT, 'docs/baselines/reviews/cid-11.json');

const run = (script) =>
  spawnSync('node', [script], { cwd: ROOT, encoding: 'utf8', env: process.env });

const origNginx = fs.readFileSync(NGINX, 'utf8');
const origReview = fs.readFileSync(REVIEW11, 'utf8');

try {
  // --- AA-14: regex-self must FAIL stage4 ---
  {
    const mutated = origNginx.replace(
      '~^/category/AI/$ "/category/ai/";',
      '~^/category/ai/$ "/category/ai/";',
    );
    assert.notEqual(mutated, origNginx, 'nginx fixture anchor missing');
    fs.writeFileSync(NGINX, mutated);
    const res = run('scripts/stage4-gate.js');
    assert.notEqual(res.status, 0, 'stage4 should fail on regex-self');
    assert.match(
      `${res.stdout}\n${res.stderr}`,
      /regex-self redirect forbidden/,
      'stage4 should mention regex-self',
    );
    fs.writeFileSync(NGINX, origNginx);
  }

  // --- AA-13: unknown reviewer + pass without reviewKind=human must FAIL ---
  {
    const review = JSON.parse(origReview);
    review.verdict = 'pass';
    review.reviewer = 'codex-auto-v2';
    delete review.reviewKind;
    fs.writeFileSync(REVIEW11, `${JSON.stringify(review, null, 2)}\n`);
    const res = run('scripts/stage8-gate.js');
    assert.notEqual(res.status, 0, 'stage8 should fail without reviewKind');
    assert.match(
      `${res.stdout}\n${res.stderr}`,
      /reviewKind must be human\|agent-spot\|audit/,
      'stage8 should require reviewKind',
    );
  }

  // --- AA-13: forged human via unknown name still needs reviewKind=human; if set wrong pair FAIL ---
  {
    const review = JSON.parse(origReview);
    review.reviewKind = 'agent-spot';
    review.verdict = 'pass';
    review.reviewer = 'codex-auto-v2';
    fs.writeFileSync(REVIEW11, `${JSON.stringify(review, null, 2)}\n`);
    const res = run('scripts/stage8-gate.js');
    assert.notEqual(res.status, 0, 'stage8 should fail on kind/verdict mismatch');
    assert.match(
      `${res.stdout}\n${res.stderr}`,
      /requires verdict=agent-spot/,
      'stage8 should enforce kind→verdict',
    );
  }
} finally {
  fs.writeFileSync(NGINX, origNginx);
  fs.writeFileSync(REVIEW11, origReview);
}

console.log(JSON.stringify({ ok: true, mutations: ['regex-self', 'missing-reviewKind', 'kind-verdict-mismatch'] }));
