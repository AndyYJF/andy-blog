/**
 * Stage 5 local gates — no production Docker required.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// Editor decision + patch artifacts
check(fs.existsSync(path.join(ROOT, 'docs/baselines/reports/stage5-editor-decision.md')), 'missing editor decision');
check(fs.existsSync(path.join(ROOT, 'patches/typecho-1.2.1/admin-origin.patch')), 'missing admin-origin.patch');
check(fs.existsSync(path.join(ROOT, 'patches/typecho-1.2.1/file-hashes.json')), 'missing file-hashes.json');
const hashes = JSON.parse(fs.readFileSync(path.join(ROOT, 'patches/typecho-1.2.1/file-hashes.json'), 'utf8'));
check(hashes.patchSha256?.length === 64, 'patch sha missing');
check(Object.keys(hashes.original || {}).length === 3, 'expected 3 original hashes');

// AutoRebuild plugin
const plugin = fs.readFileSync(path.join(ROOT, 'typecho/usr/plugins/AutoRebuild/Plugin.php'), 'utf8');
check(plugin.includes('finishPublish'), 'plugin missing finishPublish');
check(plugin.includes('metas-tag-edit'), 'plugin must enqueue rebuild on tag edits');
check(plugin.includes('metas-category-edit'), 'plugin must enqueue rebuild on category edits');
check(plugin.includes('rebuild-api:9000'), 'plugin must call service name, not 127.0.0.1');
check(plugin.includes('hash_hmac'), 'plugin missing HMAC');
check(plugin.includes("addAction('rebuild-status'"), 'plugin must register rebuild-status action');
check(plugin.includes("Common::url('/action/rebuild-status', $options->index)"), 'rebuild-status URL must use rewrite-aware index');

// rebuild-api unit tests
const apiTest = spawnSync('node', ['test.js'], {
  cwd: path.join(ROOT, 'docker/rebuild-api'),
  encoding: 'utf8',
});
check(apiTest.status === 0, `rebuild-api tests failed: ${apiTest.stderr || apiTest.stdout}`);

// Compose / nginx scaffold honesty checks
const compose = fs.readFileSync(path.join(ROOT, 'compose.yml'), 'utf8');
check(!/docker\.sock/.test(compose), 'compose must not mention docker.sock');
check(!/\/var\/run\/docker\.sock/.test(compose), 'compose must not mount docker socket path');
check(compose.includes('build: ./docker/typecho'), 'compose must build typecho service');

const nginxGen = fs.readFileSync(path.join(ROOT, 'scripts/generate-nginx.js'), 'utf8');
check(nginxGen.includes('fastcgi_pass typecho:9000'), 'CMS PHP must target typecho:9000, not 127.0.0.1');
check(!nginxGen.includes('fastcgi_pass 127.0.0.1:9000'), 'CMS must not use loopback PHP-FPM');

const cdn = fs.readFileSync(path.join(ROOT, 'host/cdn-purge.sh'), 'utf8');
const cdnRunner = fs.readFileSync(path.join(ROOT, 'scripts/run-cdn-purge.js'), 'utf8');
check(cdn.includes('scripts/run-cdn-purge.js'), 'cdn-purge wrapper must invoke the reviewed API runner');
check(!cdn.includes('not-implemented'), 'cdn-purge must not retain the old API stub');
check(cdnRunner.includes('RefreshObjectCaches') || fs.readFileSync(path.join(ROOT, 'scripts/cdn-purge-core.js'), 'utf8').includes('RefreshObjectCaches'), 'Aliyun refresh API missing');
check(cdnRunner.includes('api.cloudflare.com') || fs.readFileSync(path.join(ROOT, 'scripts/cdn-purge-core.js'), 'utf8').includes('api.cloudflare.com'), 'Cloudflare purge API missing');
check(!/purge_everything|"hosts"|"prefixes"/.test(cdnRunner), 'CDN purge must stay exact-URL scoped');

const baidu = fs.readFileSync(path.join(ROOT, 'host/baidu-push.sh'), 'utf8');
check(baidu.includes('PREV_ID="${2'), 'baidu-push must accept previous release as $2');
const rebuild = fs.readFileSync(path.join(ROOT, 'host/blog-rebuild.sh'), 'utf8');
check(rebuild.includes('PREV_SUCCESS'), 'blog-rebuild must capture previous success before overwrite');
check(rebuild.includes('baidu-push.sh" "$RELEASE_ID" "$PREV_SUCCESS"'), 'blog-rebuild must pass PREV_SUCCESS to baidu-push');

// Behavioral fixture: previous-release diff + no double-slash URLs
const baiduTest = spawnSync('bash', ['scripts/test-baidu-push.sh'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(baiduTest.status === 0, `baidu-push behavior test failed: ${baiduTest.stderr || baiduTest.stdout}`);
if (baiduTest.status === 0) {
  try {
    const body = JSON.parse((baiduTest.stdout || '').trim().split('\n').pop());
    check(body.ok === true && body.url === 'https://www.andy-y.cn/posts/added/', 'baidu-push fixture URL mismatch');
  } catch {
    failures.push('baidu-push behavior test did not emit JSON summary');
  }
}

check(/rebuild-api:/.test(compose) && /builder:/.test(compose), 'compose missing services');

// Control-plane scripts present
for (const rel of [
  'scripts/build-release.sh',
  'scripts/generate-comment-policy.js',
  'scripts/finalize-manifest.js',
  'scripts/generate-candidate-nginx.js',
  'scripts/read-db-epoch.js',
  'host/blog-rebuild.sh',
  'host/switch-release.sh',
  'host/cdn-purge.sh',
  'scripts/cdn-purge-core.js',
  'scripts/generate-cdn-purge-plan.js',
  'scripts/run-cdn-purge.js',
  'scripts/cdn-purge.test.js',
  'host/baidu-push.sh',
  'host/systemd/blog-rebuild.path',
  'host/systemd/blog-rebuild.service',
  'host/systemd/blog-reconcile.timer',
  'host/systemd/blog-reconcile.service',
]) {
  check(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
}

// Dry-run generators
const policy = spawnSync('node', ['scripts/generate-comment-policy.js', '--mode', 'disabled', '--out', '.cache/comment-policy.json'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(policy.status === 0, `comment-policy failed: ${policy.stderr}`);
const pol = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/comment-policy.json'), 'utf8'));
check(pol.writeEnabled === false, 'disabled policy must set writeEnabled=false');

const releaseId = '20260802T120000Z-deadbeef';
const releaseStateFile = path.join(ROOT, 'astro/src/generated/release-state.ts');
const releaseStateBefore = fs.readFileSync(releaseStateFile, 'utf8');
let man;
try {
  const fin = spawnSync(
    'node',
    [
      'scripts/finalize-manifest.js',
      '--release-id',
      releaseId,
      '--redirect-status',
      '302',
      '--comment-write-mode',
      'disabled',
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SNAPSHOT_EPOCH: '1785565762' } },
  );
  check(fin.status === 0, `finalize-manifest failed: ${fin.stderr}`);
  if (fin.status === 0) {
    man = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/manifest.json'), 'utf8'));
    check(man.releaseId === releaseId && man.redirectStatus === 302, 'manifest fields wrong');
  }
} finally {
  fs.writeFileSync(releaseStateFile, releaseStateBefore);
}

const cand = spawnSync(
  'node',
  ['scripts/generate-candidate-nginx.js', '--release-id', releaseId, '--out', '.cache/release-nginx'],
  { cwd: ROOT, encoding: 'utf8' },
);
check(cand.status === 0, `candidate nginx failed: ${cand.stderr}`);
const candidate = fs.readFileSync(path.join(ROOT, '.cache/release-nginx/candidate-nginx.conf'), 'utf8');
check(candidate.includes('events {'), 'candidate missing events{}');
check(candidate.includes('http {'), 'candidate missing http{}');
check(!/include\s+\/etc\/nginx\/conf\.d/.test(candidate), 'candidate must not include conf.d');
check(!/\/current\//.test(candidate), 'candidate must not reference current/');

// siteUrl allowlist against upstream 1.2.1 tree
const typechoSrc = path.join(ROOT, '.cache/typecho-src/typecho-1.2.1');
if (fs.existsSync(typechoSrc)) {
  const allow = spawnSync('node', ['scripts/typecho-siteurl-allowlist.js', typechoSrc], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  check(allow.status === 0, `siteUrl allowlist failed: ${allow.stderr || allow.stdout}`);
} else {
  failures.push('typecho 1.2.1 source missing for allowlist scan');
}

// Patch dry-run already done at generation time; re-check applies.
const apply = spawnSync(
  'git',
  ['apply', '--check', path.join(ROOT, 'patches/typecho-1.2.1/admin-origin.patch')],
  {
    cwd: path.join(ROOT, '.cache/typecho-patch-work/apply-check'),
    encoding: 'utf8',
  },
);
check(apply.status === 0, `patch --check failed: ${apply.stderr}`);

if (failures.length) {
  console.error('Stage 5 gates failed:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      patchSha256: hashes.patchSha256,
      commentPolicyEntries: Object.keys(pol.entries).length,
      releaseId: man.releaseId,
    },
    null,
    2,
  ),
);
