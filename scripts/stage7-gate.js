/**
 * Stage 7 local gates: policy, migration dry-run, middleware, frontend wiring.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

check(exists('docs/baselines/fixtures/comments-1785565762.json'), 'missing comments fixture');
check(exists('docker/waline/policy.js'), 'missing waline policy helper');
check(exists('docker/waline/server.js'), 'missing waline policy server');
check(exists('docker/waline/schema.sql'), 'missing waline schema.sql');
check(exists('docker/waline/Dockerfile'), 'missing waline Dockerfile');
check(exists('astro/src/components/Comments.astro'), 'missing Comments.astro');
check(exists('astro/src/lib/readonly-comments.js'), 'missing readonly-comments.js');
check(exists('astro/src/generated/release-state.ts'), 'missing release-state.ts');

const ro = read('astro/src/lib/readonly-comments.js');
check(ro.includes('sanitizeCommentHtml'), 'readonly must sanitize');
check(!/innerHTML\s*=\s*(raw|item\.comment)/.test(ro), 'readonly must not assign raw HTML');

const commentsAstro = read('astro/src/components/Comments.astro');
check(commentsAstro.includes('IntersectionObserver'), 'comments must lazy-load');
check(commentsAstro.includes('serverURL: window.location.origin'), 'serverURL must be origin (not /api/comment)');
check(commentsAstro.includes('@waline/client'), 'writable branch imports @waline/client');
check(commentsAstro.includes('mountReadonlyComments'), 'readonly branch wired');

const postHtmlHint = exists('astro/src/pages/posts/[id].astro')
  && read('astro/src/pages/posts/[id].astro').includes('Comments');
const pageHtmlHint = exists('astro/src/pages/[...page].astro')
  && read('astro/src/pages/[...page].astro').includes('Comments');
check(postHtmlHint, 'posts page must include Comments');
check(pageHtmlHint, 'static pages must include Comments');

const mw = spawnSync('node', ['test.js'], {
  cwd: path.join(ROOT, 'docker/waline'),
  encoding: 'utf8',
});
check(mw.status === 0, `waline policy tests failed: ${mw.stderr || mw.stdout}`);

const mig = spawnSync(
  'node',
  ['scripts/migrate-comments.js', '--epoch', '1785565762', '--backend', 'memory', '--twice'],
  { cwd: ROOT, encoding: 'utf8' },
);
check(mig.status === 0, `migrate-comments failed: ${mig.stderr || mig.stdout}`);
if (exists('.cache/comment-migration-report.json')) {
  const report = JSON.parse(read('.cache/comment-migration-report.json'));
  check(report.counts.selected === 2, 'expected 2 migratable comments from fixture');
  check(report.counts.approved === 1 && report.counts.waiting === 1, 'approved/waiting counts');
  check(report.second?.inserted === 0 && report.second?.updated === 0 && report.second?.deleted === 0, 'second run must be no-op');
}

// Policies: disabled top-level; staging enabled; entries respect allowComment
const polDisabled = spawnSync(
  'node',
  ['scripts/generate-comment-policy.js', '--mode', 'disabled', '--out', '.cache/comment-policy.json'],
  { cwd: ROOT, encoding: 'utf8' },
);
check(polDisabled.status === 0, `policy disabled failed: ${polDisabled.stderr}`);
const polEnabled = spawnSync(
  'node',
  ['scripts/generate-comment-policy.js', '--mode', 'enabled', '--out', '.cache/comment-policy.staging.json'],
  { cwd: ROOT, encoding: 'utf8' },
);
check(polEnabled.status === 0, `policy staging failed: ${polEnabled.stderr}`);

const prodPol = JSON.parse(read('.cache/comment-policy.json'));
const stagingPol = JSON.parse(read('.cache/comment-policy.staging.json'));
check(prodPol.writeEnabled === false, 'production policy must be writeEnabled=false');
check(stagingPol.writeEnabled === true, 'staging policy must be writeEnabled=true');
check(Object.keys(prodPol.entries).length >= 15, 'policy entries should cover public routes');
check(
  JSON.stringify(Object.keys(prodPol.entries).sort()) === JSON.stringify(Object.keys(stagingPol.entries).sort()),
  'prod/staging entry key sets must match',
);

const releaseState = read('astro/src/generated/release-state.ts');
check(/productionWriteEnabled:\s*false/.test(releaseState), 'local release-state defaults to disabled writes');

const compose = read('compose.yml');
check(/waline:/.test(compose) && /waline-staging:/.test(compose), 'compose missing waline services');
check(/COMMENT_POLICY_FILE/.test(compose), 'compose must mount comment policy path');
check(!/8360:8360/.test(compose), 'waline must not publish host port');

if (exists('astro/dist/posts/typecho-joe-mermaid/index.html')) {
  const html = read('astro/dist/posts/typecho-joe-mermaid/index.html');
  check(!/<link[^>]+href=["'][^"']*waline[^"']*["']/i.test(html), 'waline CSS must not be in initial head');
  check(!/<script[^>]+src=["'][^"']*@waline[^"']*["']/i.test(html), 'waline client must not be a static script src');
}

const report = { ok: failures.length === 0, failures };
fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs/baselines/reports/stage7-gates.md'),
  [
    '# Stage 7 gates',
    '',
    `**Result:** ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '- Comments fixture + memory migration idempotent (--twice)',
    '- comment-policy disabled (prod) / enabled (staging); entry keys aligned',
    '- Waline policy middleware unit tests',
    '- Comments.astro lazy IntersectionObserver + readonly branch',
    '- Compose waline / waline-staging scaffold (no host 8360 publish)',
    '',
    failures.length ? `## Failures\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '## Failures\n\n(none)',
    '',
    '## Deferred to VPS / Stage 9–10',
    '',
    '- Live MySQL Waline schema apply + digest-pinned image',
    '- Real POST 403/200 against production middleware',
    '- Mail notification / Akismet live config',
    '- Final stop-write reconciliation against production Typecho',
    '',
  ].join('\n'),
);

if (failures.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report));
