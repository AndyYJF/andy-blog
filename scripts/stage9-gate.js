/**
 * Stage 9 local gates — compose staging, staging-http, alerts, lighthouse config.
 * Dual-CDN live probe is optional (SKIP_CDN_PROBE=1 default when offline).
 * Lighthouse autorun runs when astro/dist exists unless SKIP_LIGHTHOUSE=1.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const warn = (cond, msg) => {
  if (cond) warnings.push(msg);
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// --- required artifacts ---
for (const rel of [
  'compose.yml',
  'compose.staging.yml',
  'compose.1panel-staging.yml',
  'nginx/staging-loader.conf',
  'scripts/generate-candidate-nginx.js',
  'scripts/generate-1panel-staging-nginx.js',
  'scripts/probe-dual-cdn.js',
  'scripts/lighthouse-gate.js',
  'scripts/patch-beoe-alt.js',
  'lighthouserc.cjs',
  'host/alert-notify.sh',
  'host/alert-on-failure.sh',
  'host/check-edge-pending.sh',
  'host/cert-new-andy-y.sh',
  'host/systemd/blog-rebuild-failure.service',
  'host/systemd/blog-edge-check.service',
  'host/systemd/blog-edge-check.timer',
  'docs/baselines/reports/stage9-staging-enable.md',
]) {
  check(exists(rel), `missing ${rel}`);
}

const compose = read('compose.yml');
const stagingCompose = read('compose.staging.yml');
const onePanelCompose = read('compose.1panel-staging.yml');
const walineDockerfile = read('docker/waline/Dockerfile');
check(compose.includes('SECURE_DOMAINS'), 'compose waline missing SECURE_DOMAINS');
check(compose.includes('WALINE_JWT'), 'compose waline missing JWT');
check(compose.includes('SERVER_URL: https://www.andy-y.cn'), 'compose waline missing SERVER_URL');
check(!/docker\.sock/.test(compose), 'compose must not mention docker.sock');
check(stagingCompose.includes('90-staging-loader.conf'), 'staging override missing loader mount');
check(stagingCompose.includes('waline-staging'), 'staging override missing waline-staging');
check(stagingCompose.includes('SECURE_DOMAINS: new.andy-y.cn'), 'staging SECURE_DOMAINS must be new only');
check(stagingCompose.includes('COMMENT_POLICY_FILE: /var/www/andy-y.cn/candidate/comment-policy.staging.json'), 'staging policy path wrong');
check(!/^\s{2}(?:nginx|typecho|waline):\s*$/m.test(onePanelCompose), '1Panel staging must not define production services');
check(onePanelCompose.includes("127.0.0.1:${WALINE_STAGING_HOST_PORT:-8361}:8360"), '1Panel Waline must bind loopback only');
check(onePanelCompose.includes('name: ${ONEPANEL_NETWORK:-1panel-network}'), '1Panel external network missing');
check(onePanelCompose.includes('WALINE_UPSTREAM_IMAGE: ${WALINE_UPSTREAM_IMAGE:?'), '1Panel Waline image must be required');
check(onePanelCompose.includes('NODE_BASE_IMAGE: ${WALINE_NODE_IMAGE:?'), '1Panel Node image must be required');
check(
  walineDockerfile.includes('COPY policy.js server-path.js server.js entrypoint.sh ./'),
  'Waline image must copy every policy wrapper runtime module',
);
check(
  walineDockerfile.includes('COPY waline-config.cjs /waline/node_modules/@waline/vercel/config.js'),
  'Waline image must install the ThinkJS upstream port override',
);
check(read('docker/waline/waline-config.cjs').includes('port: 8361'), 'Waline upstream must listen on 8361');

const loader = read('nginx/staging-loader.conf');
check(
  loader.includes('include /var/www/andy-y.cn/candidate/nginx/staging-http.conf'),
  'staging-loader must include candidate staging-http.conf',
);

const rebuildUnit = read('host/systemd/blog-rebuild.service');
check(rebuildUnit.includes('OnFailure=blog-rebuild-failure.service'), 'blog-rebuild missing OnFailure');

const alertNotify = read('host/alert-notify.sh');
check(alertNotify.includes('not-configured'), 'alert-notify must fail-closed without webhook');
check(alertNotify.includes('not-implemented'), 'alert-notify must not fake webhook success');
check(alertNotify.includes('exit 71'), 'alert-notify must exit 71 when not configured');

const lhci = read('lighthouserc.cjs');
check(lhci.includes('categories:performance'), 'lighthouserc missing performance assertion');
check(lhci.includes('minScore: 0.95'), 'lighthouserc performance budget');
check(lhci.includes('categories:seo'), 'lighthouserc missing seo');
check(lhci.includes('minScore: 1'), 'lighthouserc seo must be 100');
check(lhci.includes('categories:accessibility'), 'lighthouserc missing a11y');

// --- generate staging-http ---
const outNginx = path.join(ROOT, '.cache', 'stage9-nginx');
fs.rmSync(outNginx, { recursive: true, force: true });
const gen = spawnSync(
  'node',
  ['scripts/generate-candidate-nginx.js', '--release-id', '20260802T120000Z-deadbeef', '--out', outNginx],
  { cwd: ROOT, encoding: 'utf8' },
);
check(gen.status === 0, `generate-candidate-nginx failed: ${gen.stderr || gen.stdout}`);
const stagingHttp = fs.readFileSync(path.join(outNginx, 'staging-http.conf'), 'utf8');
check(stagingHttp.includes('server_name new.andy-y.cn'), 'staging-http missing new.andy-y.cn');
check(stagingHttp.includes('waline-staging:8360'), 'staging-http must proxy to waline-staging');
check(stagingHttp.includes('X-Robots-Tag'), 'staging-http missing noindex');
check(
  (stagingHttp.match(/add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/g) || []).length === 7,
  'staging-http must repeat noindex in every header-owning location',
);
check(stagingHttp.includes('$staging_legacy_target'), 'staging-http missing staging maps');
check(!/map \$uri \$legacy_target/.test(stagingHttp), 'staging-http must not define production $legacy_target');
check(!/proxy_pass http:\/\/waline:8360/.test(stagingHttp), 'staging must not use production waline');
check(fs.existsSync(path.join(outNginx, 'candidate-nginx.conf')), 'missing candidate-nginx.conf');
check(fs.existsSync(path.join(outNginx, 'candidate-staging-nginx.conf')), 'missing candidate-staging-nginx.conf');
const candStaging = fs.readFileSync(path.join(outNginx, 'candidate-staging-nginx.conf'), 'utf8');
check(candStaging.includes('staging-http.conf'), 'candidate-staging must include staging-http');

const onePanelOut = path.join(outNginx, 'new.andy-y.cn.conf');
const onePanelGen = spawnSync(
  'node',
  [
    'scripts/generate-1panel-staging-nginx.js',
    '--input',
    path.join(outNginx, 'staging-http.conf'),
    '--out',
    onePanelOut,
  ],
  { cwd: ROOT, encoding: 'utf8' },
);
check(onePanelGen.status === 0, `generate-1panel-staging-nginx failed: ${onePanelGen.stderr || onePanelGen.stdout}`);
if (onePanelGen.status === 0) {
  const onePanelNginx = fs.readFileSync(onePanelOut, 'utf8');
  check(onePanelNginx.includes('root /www/sites/new.andy-y.cn/deploy/candidate/site'), '1Panel staging root wrong');
  check(onePanelNginx.includes('proxy_pass http://127.0.0.1:8361'), '1Panel staging Waline upstream wrong');
  check(onePanelNginx.includes('/www/sites/www.andy-y.cn/ssl/fullchain.pem'), '1Panel wildcard certificate path wrong');
  check(!onePanelNginx.includes('waline-staging:8360'), '1Panel config retains Compose-only upstream');
  check(
    (onePanelNginx.match(/add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/g) || []).length === 7,
    '1Panel config must retain all staging noindex headers',
  );
}

// --- alert-notify behavioral ---
const alertTest = spawnSync('bash', ['host/alert-notify.sh', 'stage9-gate-test', 'body'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, ALERT_WEBHOOK_URL: '' },
});
check(alertTest.status === 71, `alert-notify without webhook must exit 71 (got ${alertTest.status})`);
check(
  /not-configured/.test(`${alertTest.stdout}\n${alertTest.stderr}`),
  'alert-notify should mention not-configured',
);

// --- docker compose config with fixture env ---
const envFile = path.join(ROOT, '.cache', 'stage9.env');
fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'secrets'), { recursive: true });
const secretPath = path.join(ROOT, 'secrets', 'webhook_secret');
if (!fs.existsSync(secretPath)) {
  fs.writeFileSync(secretPath, 'stage9-gate-fixture-secret-not-for-prod\n');
}
fs.writeFileSync(
  envFile,
  [
    'WWW_ROOT=/var/www/andy-y.cn',
    'DEPLOY_UID=1000',
    'DEPLOY_GID=1000',
    'NGINX_IMAGE=nginx:1.26-bookworm@sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'DB_HOST=127.0.0.1',
    'DB_NAME=typecho',
    'TYPECHO_RO_DB_USER=ro',
    'TYPECHO_RO_DB_PASSWORD=x',
    'WALINE_MYSQL_HOST=127.0.0.1',
    'WALINE_MYSQL_DB=waline',
    'WALINE_MYSQL_USER=waline',
    'WALINE_MYSQL_PASSWORD=x',
    'WALINE_SECURE_DOMAINS=www.andy-y.cn',
    'WALINE_JWT=fixture-jwt',
    'WALINE_STAGING_MYSQL_HOST=127.0.0.1',
    'WALINE_STAGING_MYSQL_DB=waline_staging',
    'WALINE_STAGING_MYSQL_USER=waline_s',
    'WALINE_STAGING_MYSQL_PASSWORD=x',
    'WALINE_STAGING_JWT=fixture-staging-jwt',
    '',
  ].join('\n'),
);

const composeBase = spawnSync(
  'docker',
  ['compose', '--env-file', envFile, '-f', 'compose.yml', 'config'],
  { cwd: ROOT, encoding: 'utf8' },
);
if (composeBase.error || composeBase.status === null) {
  warnings.push(`docker compose base config skipped: ${composeBase.error?.message || 'docker unavailable'}`);
} else {
  check(composeBase.status === 0, `docker compose config (base) failed: ${composeBase.stderr}`);
}

const composeSt = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    envFile,
    '-f',
    'compose.yml',
    '-f',
    'compose.staging.yml',
    '--profile',
    'staging',
    'config',
  ],
  { cwd: ROOT, encoding: 'utf8' },
);
if (composeSt.error || composeSt.status === null) {
  warnings.push(`docker compose staging config skipped: ${composeSt.error?.message || 'docker unavailable'}`);
} else {
  check(composeSt.status === 0, `docker compose config (staging) failed: ${composeSt.stderr}`);
  if (composeSt.status === 0) {
    check(composeSt.stdout.includes('90-staging-loader'), 'staging config missing loader mount in render');
    check(composeSt.stdout.includes('new.andy-y.cn'), 'staging config missing new host');
  }
}

// --- lighthouse ---
const skipLh = process.env.SKIP_LIGHTHOUSE === '1';
if (skipLh) {
  warnings.push('SKIP_LIGHTHOUSE=1 — lighthouse autorun skipped');
} else if (!exists('astro/dist/index.html')) {
  warnings.push('astro/dist missing — lighthouse autorun skipped (run npm run build then stage9:gate)');
} else {
  const lh = spawnSync('node', ['scripts/lighthouse-gate.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    },
  });
  check(lh.status === 0, `lighthouse-gate failed: ${(lh.stderr || lh.stdout || '').slice(-2000)}`);
}

// --- dual CDN probe (optional live) ---
const skipCdn = process.env.SKIP_CDN_PROBE !== '0';
if (skipCdn) {
  warnings.push('dual-CDN live probe skipped (set SKIP_CDN_PROBE=0 to run against www)');
} else {
  const probe = spawnSync('node', ['scripts/probe-dual-cdn.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (probe.status !== 0) {
    warnings.push(`dual-CDN probe failed (recorded): ${(probe.stderr || probe.stdout || '').slice(0, 500)}`);
  }
}

const report = {
  ok: failures.length === 0,
  failures,
  warnings,
  generatedStagingHttp: path.relative(ROOT, path.join(outNginx, 'staging-http.conf')),
};
fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs/baselines/reports/stage9-gates.md'),
  [
    '# Stage 9 gates',
    '',
    `**Result:** ${report.ok ? 'PASS' : 'FAIL'} (in-repo deploy scaffold)`,
    '',
    '- compose.yml + compose.staging.yml + staging-loader',
    '- compose.1panel-staging.yml + generated 1Panel OpenResty adapter',
    '- staging-http.conf with independent `$staging_*` maps and new.andy-y.cn → waline-staging',
    '- OnFailure alert units + fail-closed alert-notify (exit 71)',
    '- cert-new-andy-y.sh + staging enable runbook',
    '- Lighthouse budgets (Perf≥95, SEO 100, A11y≥95) via `lighthouse:local` / gate',
    '- BEOE mermaid `alt` via `scripts/patch-beoe-alt.js` (post-pagefind)',
    '- dual-CDN probe script (live optional)',
    '',
    '## Accepted debt (not Stage 9 scaffold blockers)',
    '',
    '- AA-02 human Final: closed 15/15 (`owner-final-accept`, 2026-08-05)',
    '- AA-06 full CMS vertical / AA-09 Stage0 restore evidence / AA-10 mutations',
    '- Live VPS `nginx -t`, cert issue, rollback drill — require production-write authorization',
    '- Real CDN purge OpenAPI still `not-implemented` (exit 71)',
    '- Re-run compose config on a host with Docker CLI when this machine lacks `docker`',
    '',
    warnings.length ? `## Warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}` : '## Warnings\n\n(none)',
    '',
    failures.length ? `## Failures\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '## Failures\n\n(none)',
    '',
  ].join('\n'),
);

if (failures.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report));
