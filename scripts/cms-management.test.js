import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('CMS and comment admin generators stay loopback-only and protected', () => {
  execFileSync(process.execPath, ['scripts/generate-1panel-cms-nginx.js'], { cwd: ROOT });
  execFileSync(process.execPath, ['scripts/generate-1panel-waline-admin-nginx.js'], { cwd: ROOT });
  const cms = read('.cache/stage10-nginx/cms.andy-y.cn.conf');
  const comments = read('.cache/stage10-nginx/comments.andy-y.cn.conf');
  assert.match(cms, /auth_basic_user_file/);
  assert.doesNotMatch(comments, /auth_basic/);
  for (const conf of [cms, comments]) {
    assert.match(conf, /X-Robots-Tag "noindex, nofollow, noarchive"/);
    assert.doesNotMatch(conf, /return 301/);
  }
  assert.match(cms, /proxy_pass http:\/\/127\.0\.0\.1:8080/);
  assert.match(comments, /proxy_pass http:\/\/127\.0\.0\.1:8362/);
  assert.match(comments, /location \^~ \/api\//);
  assert.match(comments, /proxy_set_header Accept-Encoding ""/);
  assert.match(comments, /sub_filter "window\.serverURL = 'https:\/\/www\.andy-y\.cn\/api\/';" "window\.serverURL = 'https:\/\/comments\.andy-y\.cn\/api\/';";/);
  assert.doesNotMatch(comments, /sub_filter 'https:\/\/www\.andy-y\.cn' 'https:\/\/comments\.andy-y\.cn'/);
  assert.match(comments, /map "\$request_method:\$http_authorization" \$andy_blog_comments_block_unauthenticated_write/);
  assert.match(comments, /location = \/api\/token \{\s+proxy_pass/);
  assert.match(comments, /location \^~ \/api\/user \{\s+if \(\$request_method = POST\) \{ return 403; \}/);
  assert.match(comments, /location \^~ \/api\/ \{\s+if \(\$andy_blog_comments_block_unauthenticated_write\) \{ return 403; \}/);
});

test('1Panel compose files expose no public service or repository nginx', () => {
  const cmsText = read('compose.1panel-cms.yml');
  const walineText = read('compose.1panel-production.yml');
  const cms = yaml.load(cmsText);
  const waline = yaml.load(walineText);
  assert.deepEqual(Object.keys(cms.services).sort(), ['builder', 'rebuild-api']);
  assert.equal(cms.services['rebuild-api'].ports, undefined);
  assert.equal(cmsText.includes('/var/run/docker.sock'), false);
  assert.equal(waline.services.waline.ports.every((entry) => entry.startsWith('127.0.0.1:')), true);
  assert.match(walineText, /WALINE_ADMIN_HOST_PORT:-8362/);
  assert.equal(cms.networks.onepanel.external, true);
});

test('automatic publishing preserves current production transition state', () => {
  const rebuild = read('host/blog-rebuild-1panel.sh');
  const switcher = read('host/switch-release-1panel.sh');
  const releaseBuild = read('scripts/build-release.sh');
  assert.match(rebuild, /REDIRECT_STATUS" == "302"/);
  assert.match(rebuild, /COMMENT_WRITE_MODE" == "enabled"/);
  assert.match(rebuild, /compose\.1panel-cms\.yml/);
  assert.match(rebuild, /ANDY_BLOG_BUILDER:-offbox/);
  assert.match(rebuild, /offbox-remote-build\.sh/);
  assert.match(rebuild, /export-typecho-snapshot\.js/);
  assert.match(rebuild, /ANDY_BLOG_BUILDER" == "vps-overlay"/);
  assert.match(rebuild, /builder bash \/app\/scripts\/build-release\.sh/);
  assert.match(rebuild, /rearm/);
  assert.match(rebuild, /runtime\/cdn/);
  assert.match(rebuild, /CDN_QUEUE_TEMP/);
  assert.match(rebuild, /warning: release switched but Aliyun CDN enqueue failed/);
  assert.match(rebuild, /cleanup-old-releases\.js/);
  assert.match(rebuild, /RELEASE_RETENTION_COUNT:-3/);
  assert.match(rebuild, /warning: release .* is live, but old release cleanup was refused or failed/);
  assert.doesNotMatch(rebuild, /TYPECHO_RO_DB_PASSWORD|DB_PASSWORD=/);
  assert.equal(
    rebuild.indexOf('cleanup-old-releases.js') > rebuild.indexOf('mv -f "$JOB_FILE"'),
    true,
    'cleanup must run only after the successful switch, CDN enqueue attempt, and job archival',
  );
  assert.match(switcher, /sha256sum -c/);
  assert.match(switcher, /compare-nginx-policy\.js/);
  assert.doesNotMatch(`${rebuild}\n${switcher}`, /cdn-purge|nginx -s reload|return 301/);
  assert.doesNotMatch(releaseBuild, /node scripts\/migrate-comments/);
  assert.match(releaseBuild, /generate-cdn-preheat-plan\.js/);
  assert.match(releaseBuild, /cleanup-old-releases\.test\.js/);
  assert.match(releaseBuild, /BUILD_LOCK_DIR:-\/runtime\/build/);
  assert.match(releaseBuild, /APP_ROOT:-\/app/);
  const envExample = read('host/offbox-builder.env.example');
  assert.match(envExample, /ANDY_BLOG_BUILDER=offbox/);
  assert.doesNotMatch(envExample, /BEGIN OPENSSH|PRIVATE KEY/);
  const executableFiles = [
    'host/blog-rebuild-1panel.sh',
    'host/switch-release-1panel.sh',
    'host/offbox-remote-build.sh',
  ];
  const gitRoot = fs.existsSync(path.join(ROOT, '.git'));
  const trackedExecutableFiles = executableFiles.filter((file) =>
    gitRoot && execFileSync('git', ['ls-files', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim(),
  );
  if (trackedExecutableFiles.length) {
    const executableModes = execFileSync('git', [
      'ls-files', '--stage', '--', ...trackedExecutableFiles,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(executableModes.trim().split('\n').every((line) => line.startsWith('100755 ')), true);
  } else {
    for (const file of executableFiles) {
      assert.notEqual(fs.statSync(path.join(ROOT, file)).mode & 0o111, 0, `${file} must be executable`);
    }
  }
  for (const file of [...executableFiles, 'scripts/build-release.sh']) {
    const tracked = gitRoot
      && execFileSync('git', ['ls-files', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim();
    const bytes = tracked
      ? execFileSync('git', ['show', `:${file}`], { cwd: ROOT })
      : fs.readFileSync(path.join(ROOT, file));
    assert.equal(bytes.includes(13), false, `${file} must use LF`);
  }
});

test('Typecho webhook target and secret fallback are fail-closed', () => {
  const plugin = read('typecho/usr/plugins/AutoRebuild/Plugin.php');
  const installer = read('scripts/activate-typecho-autorebuild.php');
  assert.match(plugin, /usr\/\.secrets\/webhook_secret/);
  assert.match(plugin, /endpoint !== 'http:\/\/rebuild-api:9000\/hooks\/rebuild'/);
  assert.match(plugin, /hash_hmac\('sha256'/);
  assert.match(plugin, /implements PluginInterface/);
  assert.match(plugin, /Plugin::factory\(\$hook\)/);
  assert.match(installer, /Plugin::activate\(\$pluginName\)/);
  assert.match(installer, /where\('name = \?', 'plugins'\)/);
});

test('production builder bakes source, dependencies, browser, and reviewed image dimensions', () => {
  const dockerfile = read('docker/builder/Dockerfile');
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm --prefix astro ci/);
  assert.match(dockerfile, /playwright install --with-deps chromium/);
  assert.match(dockerfile, /docs\/baselines\/fixtures\/img-dims\.json/);
  assert.match(dockerfile, /COPY --chown=node:node \. \./);
});

test('Waline management uses the direct upstream only on a loopback host port', () => {
  const dockerfile = read('docker/waline/Dockerfile');
  const compose = read('compose.1panel-production.yml');
  assert.match(dockerfile, /EXPOSE 8360 8361/);
  assert.equal(dockerfile.includes("RUN sed -i 's/\\r$//' entrypoint.sh"), true);
  assert.match(compose, /127\.0\.0\.1:\$\{WALINE_ADMIN_HOST_PORT:-8362\}:8361/);
  assert.match(compose, /COMMENT_AUDIT: 'true'/);
});
