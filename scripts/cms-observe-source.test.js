import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'i18n-observe-live.js');

function releaseDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-observe-'));
  const releaseId = '20261011T050000Z-abcdef12';
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({
    releaseId,
    localizedEntries: [{
      renderExpected: true,
      translationVersionId: 10,
      sourceCid: 2,
      locale: 'en',
    }],
  })}\n`);
  return dir;
}

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('live observation follows the content source prefix and refuses the other one', () => {
  const dir = releaseDir();
  try {
    const typecho = run(['--release-dir', dir, '--prefix', 'typecho_'], {
      CONTENT_SOURCE: '',
      DB_PREFIX: '',
    });
    assert.equal(typecho.status, 0, typecho.stderr);
    assert.match(typecho.stdout, /UPDATE typecho_i18n_publish_outbox/);
    assert.doesNotMatch(typecho.stdout, /cms_i18n_/);

    const cms = run(['--release-dir', dir], {
      CONTENT_SOURCE: 'cms',
      DB_PREFIX: 'cms_',
    });
    assert.equal(cms.status, 0, cms.stderr);
    assert.match(cms.stdout, /UPDATE cms_i18n_publish_outbox/);
    assert.doesNotMatch(cms.stdout, /typecho_i18n_/);

    const mixed = run(['--release-dir', dir, '--prefix', 'typecho_'], {
      CONTENT_SOURCE: 'cms',
      DB_PREFIX: 'cms_',
    });
    assert.equal(mixed.status, 64);
    assert.match(mixed.stderr, /does not match content source cms/);
    assert.doesNotMatch(mixed.stdout, /UPDATE /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
