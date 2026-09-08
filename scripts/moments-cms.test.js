import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CDN_PURGE_SITE, createPurgePlan, verifyPurgePlan } from './cdn-purge-core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Moments plugin exposes mobile panel, fields, and rebuild hook', () => {
  const plugin = read('typecho/usr/plugins/Moments/Plugin.php');
  const action = read('typecho/usr/plugins/Moments/Action.php');
  const panel = read('typecho/usr/plugins/Moments/panel.php');
  const js = read('typecho/usr/plugins/Moments/assets/panel.js');
  const installer = read('scripts/activate-typecho-moments.php');
  const rebuild = read('typecho/usr/plugins/AutoRebuild/Plugin.php');

  assert.match(plugin, /Helper::addPanel\(3, 'Moments\/panel\.php'/);
  assert.match(plugin, /Helper::addAction\('moments'/);
  assert.match(action, /content_kind/);
  assert.match(action, /moment_images/);
  assert.match(action, /moment_topics/);
  assert.match(action, /heic-unsupported/);
  assert.match(action, /clientToken/);
  assert.match(action, /START TRANSACTION/);
  assert.match(action, /wasPublic/);
  assert.match(action, /已撤回，网站更新中/);
  assert.match(action, /case 'rebuild'/);
  assert.match(action, /AutoRebuild_Plugin::trigger\(\) === true/);
  const retryFn = action.match(/private function retryRebuild\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(retryFn, 'retryRebuild present');
  assert.doesNotMatch(retryFn[0], /isMomentCid/);
  assert.match(action, /GET_LOCK/);
  assert.match(action, /exif-missing|gd-missing/);
  assert.match(action, /format-passthrough/);
  assert.match(action, /jpeg' && !\$scrub\['cleaned'\]/);
  assert.match(action, /normalizePublicImage/);
  assert.match(action, /LIST_LIMIT/);
  assert.match(action, /beforeCreated/);
  assert.match(panel, /说点什么/);
  assert.match(panel, /getToken\(/);
  assert.match(panel, /moments-app/);
  assert.match(js, /clientToken/);
  assert.match(js, /HEIC/);
  assert.match(js, /confirm\(/);
  assert.match(js, /重试更新|rebuild/);
  assert.match(js, /加载更多|load-more/);
  assert.match(installer, /Plugin::activate\(\$pluginName\)/);
  assert.doesNotMatch(installer, /call_user_func\(\$className, 'activate'\)/);
  assert.match(installer, /removePanel\(3, 'Moments\/panel\.php'\)/);
  assert.match(installer, /panelTable/);
  assert.match(installer, /Moments_Plugin/);
  assert.match(read('scripts/repair-typecho-moments-panel.php'), /PANEL_OK|child_hits/);
  assert.match(rebuild, /return true;/);
  assert.match(rebuild, /return false;/);
});

test('frontend nav places 闲话 after 文章 and moments stay out of article RSS', () => {
  const layout = read('astro/src/layouts/BaseLayout.astro');
  const articleRss = read('astro/src/pages/rss.xml.js');
  const momentsRss = read('astro/src/pages/moments/rss.xml.js');
  assert.match(layout, /href: "\/posts\/", label: "文章"/);
  assert.match(layout, /href: "\/moments\/", label: "闲话"/);
  const postsIdx = layout.indexOf('label: "文章"');
  const momentsIdx = layout.indexOf('label: "闲话"');
  assert.ok(postsIdx >= 0 && momentsIdx > postsIdx);
  assert.match(articleRss, /getCollection\('posts'/);
  assert.doesNotMatch(articleRss, /moments/);
  assert.match(momentsRss, /getCollection\('moments'/);
  assert.match(momentsRss, /\/moments\/rss\.xml/);
});

test('render-gate expects moments under dist/moments/<id>/', () => {
  const gate = read('scripts/render-gate.js');
  assert.match(gate, /collection === 'moments'/);
  assert.match(gate, /path\.join\(DIST, 'moments', slug\)/);
});

test('empty moments feed still reserves /moments/ lastmod in sync source', () => {
  const sync = read('scripts/sync-typecho.js');
  assert.match(sync, /Astro always emits \/moments\//);
  assert.match(sync, /sitemapLastmod\['\/moments\/'\] = isoFromUnix\(epoch\)/);
  const astro = read('astro/astro.config.mjs');
  assert.match(astro, /\/moments\/rss\.xml/);
});

test('tombstoned moments keep ?p=cid legacy redirects for unattended switch', () => {
  const legacy = read('scripts/build-legacy-url-map.js');
  assert.match(legacy, /tombstone/);
  assert.match(legacy, /route\.kind === 'moment'/);
  assert.match(legacy, /\$\{cid\}/);
});

test('CDN purge plan includes moments list, rss, detail extras, and previous pages helper', () => {
  const core = read('scripts/cdn-purge-core.js');
  const generator = read('scripts/generate-cdn-purge-plan.js');
  assert.match(core, /\/moments\//);
  assert.match(core, /\/moments\/rss\.xml/);
  assert.match(core, /extraPaths/);
  assert.match(generator, /collectMomentPaths/);
  assert.match(generator, /listMomentPagePathsFromSite/);
  assert.match(generator, /WWW_ROOT/);
  assert.match(generator, /route-map\.json/);

  const plan = createPurgePlan({
    releaseId: '20260908T010000Z-abcd1234',
    legacy: [{ oldPath: '/legacy-x/', action: 'redirect', targetPath: '/posts/x/' }],
    extraPaths: ['/moments/', '/moments/rss.xml', '/moments/9001/', '/moments/page/2/'],
  });
  verifyPurgePlan(plan, '20260908T010000Z-abcd1234');
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/rss.xml`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/9001/`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/page/2/`));
});
