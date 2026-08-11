/**
 * Stage 10 local gates — cutover scaffold per docs/plan.md §8.5.
 * Does not perform live www DNS cutover.
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

for (const rel of [
  'host/switch-release.sh',
  'host/rollback-release.sh',
  'host/roll-forward-release.sh',
  'host/transition-deploy-state.sh',
  'host/comment-stop-write-checklist.sh',
  'host/cdn-purge.sh',
  'scripts/cdn-purge-core.js',
  'scripts/generate-cdn-purge-plan.js',
  'scripts/run-cdn-purge.js',
  'scripts/cdn-purge.test.js',
  'host/deploy-mapping-repair-1panel.sh',
  'scripts/validate-1panel-mapping-repair.js',
  'scripts/mapping-repair.test.js',
  'scripts/generate-www-cutover-http.js',
  'scripts/nginx-uri.js',
  'scripts/nginx-uri.test.js',
  'scripts/generate-1panel-www-nginx.js',
  'scripts/generate-1panel-staging-nginx.js',
  'scripts/migrate-comments-mysql.js',
  'scripts/export-typecho-comments-mysql.js',
  'scripts/lib/comment-migration-core.js',
  'scripts/lib/comment-migration-mysql.js',
  'scripts/lib/typecho-comment-export.js',
  'scripts/comment-migration-core.test.js',
  'scripts/comment-migration-mysql.test.js',
  'scripts/comment-migration-cli.test.js',
  'scripts/typecho-comment-export.test.js',
  'scripts/typecho-comment-readonly-guard.test.js',
  'host/install-typecho-comment-readonly-guard.sh',
  'host/enable-production-comments-1panel.sh',
  'scripts/build-1panel-comment-enable-release.sh',
  'scripts/phase9c-validate-release.js',
  'compose.1panel-production.yml',
  'compose.1panel-staging.yml',
  'docs/baselines/reports/stage10-www-cutover.md',
  'docs/baselines/reports/stage10-comment-cutover-plan.md',
  'docs/baselines/reports/stage10-302-observation-window.md',
  'scripts/stage10-observation.js',
  'scripts/stage10-observation.test.js',
  'docs/baselines/reports/stage10-production-waline-readiness-authorization.md',
  'docs/baselines/reports/stage10-comment-migration-authorization.md',
  'docs/baselines/reports/stage10-comment-enable-authorization.md',
  'docs/baselines/reports/stage10-mapping-repair-authorization.md',
  'docs/baselines/reports/stage9-staging-enable.md',
]) {
  check(exists(rel), `missing ${rel}`);
}

const rollback = read('host/rollback-release.sh');
check(rollback.includes('previous'), 'rollback must use previous symlink');
check(rollback.includes('manifest.json'), 'rollback must sync from manifest');
check(rollback.includes('redirect-status'), 'rollback must restore redirect-status');
check(rollback.includes('comment-write-mode'), 'rollback must restore comment-write-mode');
check(rollback.includes('mv -T'), 'rollback must atomically replace symlinks');

const rollForward = read('host/roll-forward-release.sh');
check(rollForward.includes('previous'), 'roll-forward must read previous');
check(rollForward.includes('switch-release.sh') || rollForward.includes('current.next'), 'roll-forward must switch current');

const transition = read('host/transition-deploy-state.sh');
check(transition.includes('redirect-status'), 'transition missing redirect-status');
check(transition.includes('comment-write-mode'), 'transition missing comment-write-mode');
check(transition.includes('transitions/'), 'transition must write audit descriptors');
check(!/webhook/i.test(transition), 'transition must not be webhook-driven');

const checklist = read('host/comment-stop-write-checklist.sh');
check(checklist.includes('disabled'), 'stop-write checklist must require disabled mode');
check(checklist.includes('POST'), 'stop-write checklist must probe POST');

const cdn = read('host/cdn-purge.sh');
const cdnCore = read('scripts/cdn-purge-core.js');
const cdnRunner = read('scripts/run-cdn-purge.js');
check(cdn.includes('scripts/run-cdn-purge.js'), 'cdn-purge wrapper must invoke reviewed runner');
check(!cdn.includes('not-implemented'), 'cdn-purge must not retain the old API stub');
check(cdnCore.includes('ACS3-HMAC-SHA256') && cdnCore.includes('RefreshObjectCaches'), 'Aliyun V3 purge integration missing');
check(cdnCore.includes('api.cloudflare.com/client/v4/zones/'), 'Cloudflare purge integration missing');
check(!/purge_everything|"hosts"|"prefixes"/.test(`${cdn}\n${cdnCore}\n${cdnRunner}`), 'cdn-purge escaped exact-URL scope');
check(read('scripts/build-release.sh').includes('cdn-purge-plan.json'), 'release build must embed immutable CDN purge plan');

const mappingRepair = read('host/deploy-mapping-repair-1panel.sh');
const mappingValidator = read('scripts/validate-1panel-mapping-repair.js');
check(mappingRepair.includes("[[ \"$(cat \"$STATE_DIR/redirect-status\")\" == '302' ]]"), 'mapping repair must require redirect 302');
check(mappingRepair.includes("[[ \"$(cat \"$STATE_DIR/comment-write-mode\")\" == 'enabled' ]]"), 'mapping repair must preserve enabled comments');
check(mappingRepair.includes('validate-1panel-mapping-repair.js'), 'mapping repair must invoke exact-diff validator');
check(mappingRepair.includes('generate-www-cutover-http.js'), 'mapping repair must generate production www HTTP config');
check(mappingRepair.includes('--input "$PRODUCTION_HTTP"'), 'mapping repair adapter must consume production HTTP config');
check(!mappingRepair.includes('--input "$RELEASE_DIR/nginx/release-http.conf"'), 'mapping repair must not adapt staging noindex config');
check((mappingRepair.match(/<\/dev\/null/g) || []).length === 2, 'mapping repair compose runs must not consume SSH script stdin');
check(mappingRepair.includes("atomic_state_write 'edge-pending'"), 'mapping repair must leave CDN state pending');
check(mappingRepair.includes('restore_transaction'), 'mapping repair must implement rollback');
check(!/redirect-status 301|transition-deploy-state|cdn-purge\.sh|docker compose.*nginx|POST \/api/i.test(mappingRepair), 'mapping repair escaped its bounded scope');
check(mappingValidator.includes('candidate vhost contains changes outside the single reviewed mapping line'), 'mapping validator must reject policy drift');

const onePanelProd = read('compose.1panel-production.yml');
check(onePanelProd.includes("127.0.0.1:${WALINE_HOST_PORT:-8360}:8360"), 'prod Waline must bind loopback 8360');
check(onePanelProd.includes("127.0.0.1:${WALINE_ADMIN_HOST_PORT:-8362}:8361"), 'Waline admin must bind direct upstream to loopback only');
check(onePanelProd.includes('WALINE_SECURE_DOMAINS:-www.andy-y.cn,comments.andy-y.cn'), 'prod secure origins must be public www plus protected admin');
check(onePanelProd.includes('COMMENT_POLICY_FILE: /var/www/andy-y.cn/current/comment-policy.json'), 'prod policy path wrong');
check(!/^\s{2}(?:nginx|typecho):\s*$/m.test(onePanelProd), '1Panel prod compose must not define nginx/typecho');
check(onePanelProd.includes('name: ${ONEPANEL_NETWORK:-1panel-network}'), '1Panel prod external network missing');
check(onePanelProd.includes('path=%2Fposts%2Ftypecho-joe-mermaid%2F'), 'prod healthcheck must use a real commentKey');
check(onePanelProd.includes("Origin:'https://www.andy-y.cn'"), 'prod healthcheck must send the production Origin');
check(onePanelProd.includes('r.status === 200'), 'prod healthcheck must require HTTP 200');
check(!onePanelProd.includes('r.status < 500'), 'prod healthcheck must not accept 403 as healthy');

const onePanelStaging = read('compose.1panel-staging.yml');
check(onePanelStaging.includes('path=%2Fposts%2Ftypecho-joe-mermaid%2F'), 'staging healthcheck must use a real commentKey');
check(onePanelStaging.includes("Origin:'https://new.andy-y.cn'"), 'staging healthcheck must send the staging Origin');
check(onePanelStaging.includes('r.status === 200'), 'staging healthcheck must require HTTP 200');
check(!onePanelStaging.includes('r.status < 500'), 'staging healthcheck must not accept 403 as healthy');

const runbook = read('docs/baselines/reports/stage10-www-cutover.md');
check(runbook.includes('commentWriteMode'), 'runbook missing commentWriteMode');
check(runbook.includes('302'), 'runbook missing initial 302');
check(runbook.includes('301'), 'runbook missing 301 observation step');
check(runbook.includes('rollback-release.sh'), 'runbook missing rollback');
check(runbook.includes('7'), 'runbook missing observation window');

const commentPlan = read('docs/baselines/reports/stage10-comment-cutover-plan.md');
check(commentPlan.includes("source='typecho'"), 'comment plan must scope Typecho mappings');
check(commentPlan.includes('--apply-sweep'), 'comment plan must make absent-key sweep explicit');
check(commentPlan.includes('second run must report'), 'comment plan must require an idempotent second run');
check(commentPlan.includes('Redirect status remains 302'), 'comment plan must preserve 302');
check(/explicit\s+authorization/.test(commentPlan), 'comment plan must retain the VPS authorization boundary');

const mysqlCli = read('scripts/migrate-comments-mysql.js');
check(mysqlCli.includes("database !== 'waline'"), 'MySQL migration must target only production waline');
check(mysqlCli.includes('--confirm-source-sha'), 'MySQL apply must confirm the fixed source SHA-256');
check(mysqlCli.includes("if (!args['--twice'])"), 'MySQL migration must require two passes');
check(mysqlCli.includes("fs.openSync(reportPath, 'wx', 0o600)"), 'migration report must be exclusive and mode 0600');
check(mysqlCli.includes('no comment body, mail, IP, user agent'), 'migration report must exclude comment PII');
check(mysqlCli.includes('includeIds: true'), 'migration report must expose exact pending/deleted legacy keys');

const mysqlBackend = read('scripts/lib/comment-migration-mysql.js');
check(mysqlBackend.includes('GET_LOCK'), 'MySQL migration must acquire a named lock');
check(mysqlBackend.includes('SERIALIZABLE'), 'MySQL migration must use a serializable transaction');
check(mysqlBackend.includes('applySweep'), 'MySQL absent-key sweep must be explicit');
check(mysqlBackend.includes('second migration pass was not a no-op'), 'MySQL migration must block non-idempotent second pass');
check(mysqlBackend.includes("m.source = ?"), 'MySQL reconciliation must scope source namespace');

const typechoExporter = read('scripts/export-typecho-comments-mysql.js');
const typechoExportCore = read('scripts/lib/typecho-comment-export.js');
const typechoGuard = read('host/install-typecho-comment-readonly-guard.sh');
check(typechoExporter.includes("fs.openSync(outputPath, 'wx', 0o600)"), 'Typecho export must be exclusive mode 0600');
check(typechoExportCore.includes('START TRANSACTION READ ONLY'), 'Typecho export must use a read-only transaction');
check(typechoExportCore.includes('readonly guard count mismatch'), 'Typecho export must require the readonly guard');
check(typechoGuard.includes('BEFORE INSERT ON'), 'Typecho INSERT guard missing');
check(typechoGuard.includes('BEFORE UPDATE ON'), 'Typecho UPDATE guard missing');
check(typechoGuard.includes('BEFORE DELETE ON'), 'Typecho DELETE guard missing');
check(typechoGuard.includes('allow_comment_sha256'), 'Typecho guard must preserve allowComment state');
check(!/docker\s+(?:stop|restart)\b/.test(typechoGuard), 'Typecho guard must not stop or restart containers');

const commentTests = spawnSync(
  'node',
  [
    '--test',
    'scripts/comment-migration-core.test.js',
    'scripts/comment-migration-mysql.test.js',
    'scripts/comment-migration-cli.test.js',
    'scripts/typecho-comment-export.test.js',
    'scripts/typecho-comment-readonly-guard.test.js',
  ],
  { cwd: ROOT, encoding: 'utf8' },
);
check(commentTests.status === 0, `comment migration tests failed: ${commentTests.stderr || commentTests.stdout}`);

const mappingTests = spawnSync('node', ['--test', 'scripts/mapping-repair.test.js'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(mappingTests.status === 0, `mapping repair tests failed: ${mappingTests.stderr || mappingTests.stdout}`);

const observation = read('docs/baselines/reports/stage10-302-observation-window.md');
check(observation.includes('PROHIBITED'), 'observation checklist must prohibit 301 before approval');
check(observation.includes('2026-08-12'), 'observation checklist missing provisional day-7 boundary');
check(/not been deployed or called with real\s+credentials/.test(observation), 'observation checklist must disclose that real CDN purge evidence is still missing');
check(observation.includes('origin, Aliyun, and Cloudflare'), 'observation checklist must require three-vantage agreement');
const observationCollector = read('scripts/stage10-observation.js');
check(observationCollector.includes("new Set(['GET', 'HEAD'])"), 'observation collector must be locked to GET/HEAD');
check(observationCollector.includes('OBSERVATION_FAIL_301_PROHIBITED'), 'observation collector must fail closed for 301');
check(observationCollector.includes("expectedServer:'cloudflare'"), 'observation collector must identify a Cloudflare vantage');

const readinessAuthorization = read('docs/baselines/reports/stage10-production-waline-readiness-authorization.md');
check(
  /\*\*Status:\*\* `(AWAITING_OWNER_AUTHORIZATION|AUTHORIZED_BOUNDED_READINESS|PAUSED_NEEDS_AUTH_PLUGIN_EXPANSION|READINESS_COMPLETE)`/.test(
    readinessAuthorization,
  ),
  'Waline readiness report must use a recognized authorization state',
);
check(readinessAuthorization.includes('Keep `redirect-status=302`'), 'Waline readiness must preserve 302');
check(readinessAuthorization.includes('no Typecho comment stop-write'), 'Waline readiness must exclude Typecho stop-write');
check(readinessAuthorization.includes('no CDN purge'), 'Waline readiness must exclude purge');
check(readinessAuthorization.includes('no database restore or destructive cleanup'), 'Waline readiness must exclude destructive cleanup');

const commentMigrationAuthorization = read('docs/baselines/reports/stage10-comment-migration-authorization.md');
check(
  /\*\*Status:\*\* `(AWAITING_CLOSED_KEY_AND_OWNER_AUTHORIZATION|AUTHORIZED_PHASE9B|PHASE9B_COMPLETE)`/.test(
    commentMigrationAuthorization,
  ),
  'Phase 9b report must use a recognized authorization state',
);
check(commentMigrationAuthorization.includes('Stop. Do not enable comments'), 'Phase 9b must stop before comment enable');
check(commentMigrationAuthorization.includes('no staging database/container read, write, merge, restart, or migration'), 'Phase 9b must preserve staging isolation');
check(commentMigrationAuthorization.includes('no CDN purge'), 'Phase 9b must exclude CDN purge');

const commentEnableAuthorization = read('docs/baselines/reports/stage10-comment-enable-authorization.md');
check(
  /\*\*Status:\*\* `(AWAITING_OWNER_AUTHORIZATION|AUTHORIZED_PHASE9C|PHASE9C_COMPLETE|ROLLED_BACK)`/.test(
    commentEnableAuthorization,
  ),
  'Phase 9c report must use a recognized authorization state',
);
check(commentEnableAuthorization.includes('redirect-status=302'), 'Phase 9c must preserve redirect 302');
check(commentEnableAuthorization.includes('entry-not-writable'), 'Phase 9c must test the selected closed key');
check(commentEnableAuthorization.includes('unknown-key'), 'Phase 9c must test an unknown key separately');
check(/one\s+retained\s+open-key\s+POST/.test(commentEnableAuthorization), 'Phase 9c must disclose its one retained production write');
check(commentEnableAuthorization.includes('no CDN purge'), 'Phase 9c must exclude CDN purge');
check(commentEnableAuthorization.includes('no OpenResty configuration write/reload'), 'Phase 9c must preserve 1Panel OpenResty');
check(commentEnableAuthorization.includes('no staging database/container/site read'), 'Phase 9c must preserve staging isolation');

const phase9cRunner = read('host/enable-production-comments-1panel.sh');
check(phase9cRunner.includes('transition_script" comment-write-mode enabled'), 'Phase 9c must use the state transition script');
check(phase9cRunner.includes('transition_script" comment-write-mode disabled'), 'Phase 9c failure must transition back to disabled');
check(phase9cRunner.includes('entry-not-writable'), 'Phase 9c runner must assert closed-key denial');
check(phase9cRunner.includes('unknown-key'), 'Phase 9c runner must assert unknown-key denial');
check(!/docker compose|cdn-purge|redirect-status 301|openresty.+reload|waline_staging/i.test(phase9cRunner), 'Phase 9c runner escaped its 1Panel scope');

const phase9cBuilder = read('scripts/build-1panel-comment-enable-release.sh');
check(phase9cBuilder.includes("REDIRECT_STATUS='302' COMMENT_WRITE_MODE='enabled'"), 'Phase 9c builder must be fixed to 302 + enabled');
check(!/--status 301|redirect-status 301/.test(phase9cBuilder), 'Phase 9c builder must not create a 301 release');

// --- generate www cutover + 1Panel adapter ---
const outNginx = path.join(ROOT, '.cache', 'stage10-nginx');
fs.rmSync(outNginx, { recursive: true, force: true });
fs.mkdirSync(outNginx, { recursive: true });

const gen302 = spawnSync(
  'node',
  [
    'scripts/generate-www-cutover-http.js',
    '--status',
    '302',
    '--out',
    path.join(outNginx, 'www-cutover-http.conf'),
  ],
  { cwd: ROOT, encoding: 'utf8' },
);
check(gen302.status === 0, `generate-www-cutover-http 302 failed: ${gen302.stderr || gen302.stdout}`);

const wwwHttp = fs.readFileSync(path.join(outNginx, 'www-cutover-http.conf'), 'utf8');
check(wwwHttp.includes('server_name www.andy-y.cn;'), 'www-cutover missing www server');
check(wwwHttp.includes('return 302 https://www.andy-y.cn'), 'www-cutover must use 302 in observation');
check(wwwHttp.includes('proxy_pass http://waline:8360'), 'www-cutover must default to compose waline');
check(!/noindex/.test(wwwHttp), 'www-cutover must not noindex production');
check(wwwHttp.includes('map $uri $legacy_target'), 'www-cutover missing legacy maps');
check(wwwHttp.includes('分析fen-x'), 'www-cutover must use the decoded nginx $uri key for the encoded Chinese legacy path');
check(!wwwHttp.includes('%E5%88%86%E6%9E%90fen-x'), 'www-cutover must not compare encoded text against nginx $uri');
check(wwwHttp.includes('location = /admin'), 'www-cutover must 404 admin');

const onePanelGen = spawnSync(
  'node',
  [
    'scripts/generate-1panel-www-nginx.js',
    '--input',
    path.join(outNginx, 'www-cutover-http.conf'),
    '--out',
    path.join(outNginx, 'www.andy-y.cn.conf'),
  ],
  { cwd: ROOT, encoding: 'utf8' },
);
check(onePanelGen.status === 0, `generate-1panel-www-nginx failed: ${onePanelGen.stderr || onePanelGen.stdout}`);
if (onePanelGen.status === 0) {
  const adapted = fs.readFileSync(path.join(outNginx, 'www.andy-y.cn.conf'), 'utf8');
  check(adapted.includes('root /www/sites/www.andy-y.cn/deploy/current/site;'), '1Panel www root wrong');
  check(adapted.includes('proxy_pass http://127.0.0.1:8360'), '1Panel www Waline upstream wrong');
  check(adapted.includes('/www/sites/www.andy-y.cn/ssl/fullchain.pem'), '1Panel www cert path wrong');
  check(!adapted.includes('proxy_pass http://waline:8360'), '1Panel www retains Compose waline upstream');
  check(!/noindex/.test(adapted), '1Panel www must not noindex');
  check(adapted.includes('分析fen-x'), '1Panel www must retain the decoded nginx $uri key');
  check(!adapted.includes('%E5%88%86%E6%9E%90fen-x'), '1Panel www must not restore the encoded nginx $uri key');
}

const gen301 = spawnSync(
  'node',
  [
    'scripts/generate-www-cutover-http.js',
    '--status',
    '301',
    '--out',
    path.join(outNginx, 'www-cutover-http.301.conf'),
  ],
  { cwd: ROOT, encoding: 'utf8' },
);
check(gen301.status === 0, `generate-www-cutover-http 301 failed: ${gen301.stderr || gen301.stdout}`);
if (gen301.status === 0) {
  const www301 = fs.readFileSync(path.join(outNginx, 'www-cutover-http.301.conf'), 'utf8');
  check(www301.includes('return 301 https://www.andy-y.cn'), '301 cutover must emit 301 redirects');
  check(!www301.includes('return 302 https://www.andy-y.cn$legacy'), '301 cutover must not keep 302 legacy returns');
}

// --- transition script dry-run in temp state dir ---
const stateDir = path.join(ROOT, '.cache', 'stage10-state');
fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(stateDir, 'redirect-status'), '302\n');
fs.writeFileSync(path.join(stateDir, 'comment-write-mode'), 'disabled\n');

const isWin = process.platform === 'win32';
const bash = isWin ? 'bash' : 'bash';
const tr = spawnSync(
  bash,
  ['host/transition-deploy-state.sh', 'redirect-status', '301'],
  {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, WWW_ROOT: stateDir, STATE_DIR: stateDir },
  },
);
if (tr.error || tr.status === null) {
  warnings.push(`transition dry-run skipped: ${tr.error?.message || 'bash unavailable'}`);
} else {
  check(tr.status === 0, `transition-deploy-state failed: ${tr.stderr || tr.stdout}`);
  if (tr.status === 0) {
    check(
      fs.readFileSync(path.join(stateDir, 'redirect-status'), 'utf8').trim() === '301',
      'transition did not persist 301',
    );
    const descs = fs.readdirSync(path.join(stateDir, 'transitions'));
    check(descs.some((n) => n.includes('redirect-status')), 'transition descriptor missing');
  }
}

const badTr = spawnSync(bash, ['host/transition-deploy-state.sh', 'redirect-status', '307'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, WWW_ROOT: stateDir, STATE_DIR: stateDir },
});
if (!badTr.error && badTr.status !== null) {
  check(badTr.status !== 0, 'transition must reject non-enum redirect-status');
}

// --- cdn-purge fail-closed before network when credentials are absent ---
const purgeDir = path.join(ROOT, '.cache', 'stage10-cdn');
fs.rmSync(purgeDir, { recursive: true, force: true });
const purgeReleaseId = '20260805T143100Z-c92e7d31';
fs.mkdirSync(path.join(purgeDir, 'state'), { recursive: true });
fs.mkdirSync(path.join(purgeDir, 'releases', purgeReleaseId), { recursive: true });
const purgePlan = spawnSync('node', ['scripts/generate-cdn-purge-plan.js', '--release-id', purgeReleaseId, '--out', path.join(purgeDir, 'releases', purgeReleaseId, 'cdn-purge-plan.json')], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(purgePlan.status === 0, `cdn purge plan generation failed: ${purgePlan.stderr || purgePlan.stdout}`);
const purge = spawnSync('node', ['scripts/run-cdn-purge.js', '--release-id', purgeReleaseId], {
  cwd: ROOT,
  encoding: 'utf8',
  env: {
    ...process.env,
    WWW_ROOT: purgeDir,
    STATE_DIR: path.join(purgeDir, 'state'),
    ALIYUN_CDN_ACCESS_KEY_ID: '',
    ALIYUN_CDN_ACCESS_KEY_SECRET: '',
    ALIYUN_CDN_DOMAIN: '',
    CF_API_TOKEN: '',
    CF_ZONE_ID: '',
  },
});
if (purge.error || purge.status === null) {
  warnings.push(`cdn-purge missing-credential check skipped: ${purge.error?.message || 'bash unavailable'}`);
} else {
  check(purge.status === 72, `cdn-purge without credentials must exit 72 (got ${purge.status})`);
  const purgeJobFile = path.join(purgeDir, 'state', 'cdn-jobs', `${purgeReleaseId}.json`);
  check(fs.existsSync(purgeJobFile), 'missing-credential purge must persist a blocked job');
  if (fs.existsSync(purgeJobFile)) {
    const purgeJob = JSON.parse(fs.readFileSync(purgeJobFile, 'utf8'));
    check(purgeJob.status == null && purgeJob.aliyun.status === 'blocked', 'missing credentials must not mark CDN job ok');
  }
}

// Stage 8 Final must be closed before Stage 10 cutover prep
const stage8 = read('docs/baselines/reports/stage8-gates.md');
check(/Human Final \(reviewKind=human\): 15/.test(stage8), 'Stage 8 human Final must be 15/15 before Stage 10');

const report = {
  ok: failures.length === 0,
  failures,
  warnings,
  generated: path.relative(ROOT, path.join(outNginx, 'www-cutover-http.conf')),
};

fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs/baselines/reports/stage10-gates.md'),
  [
    '# Stage 10 gates',
    '',
    `**Result:** ${report.ok ? 'PASS' : 'FAIL'} (in-repo cutover scaffold)`,
    '',
    '- rollback-release.sh / roll-forward-release.sh (manifest state sync)',
    '- transition-deploy-state.sh (302↔301, comment disabled↔enabled + audit descriptors)',
    '- generate-www-cutover-http.js + generate-1panel-www-nginx.js',
    '- compose.1panel-production.yml (Waline loopback 8360)',
    '- comment-stop-write-checklist.sh',
    '- production MySQL migration backend (dry-run default, named lock, transaction, twice + zero-diff reconciliation)',
    '- guard-protected Typecho fixed exporter + permanent comment-table readonly guard',
    '- stage10-www-cutover.md runbook (§8.5 order)',
    '- CDN purge is exact-URL and fail-closed; real provider IDs plus a post-propagation matrix are still required',
    '',
    '## Accepted debt (live VPS / secrets — not Stage 10 scaffold blockers)',
    '',
    '- Separate comment-enable release remains pending owner authorization',
    '- Observation evidence still has public-CDN legacy 200 versus origin 302',
    '- Real Aliyun / Cloudflare purge OpenAPI wiring',
    '- cms.andy-y.cn vertical on 1Panel (AA-06)',
    '- 7-day 302 observation then authorized 301 transition',
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
