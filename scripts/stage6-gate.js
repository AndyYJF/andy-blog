/**
 * Stage 6 gates: Pagefind, taxonomies, pagination, 404, lastmod/sitemap alignment.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'astro', 'dist');
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

check(exists('astro/dist/index.html'), 'missing dist/index.html — run build first');
if (!exists('astro/dist/index.html')) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

check(exists('astro/dist/pagefind/pagefind.js'), 'missing pagefind.js');
check(exists('astro/dist/pagefind/pagefind-ui.js'), 'missing pagefind-ui.js');
check(exists('astro/dist/pagefind/pagefind-ui.css'), 'missing pagefind-ui.css');
if (exists('astro/dist/pagefind')) {
  check(
    fs.readdirSync(path.join(DIST, 'pagefind')).some((f) => f.endsWith('.pf_meta') || f.includes('wasm') || f.endsWith('.pf_index')),
    'pagefind index artifacts missing',
  );
} else {
  check(false, 'missing dist/pagefind directory');
}

// Lazy UI: built HTML must not preload Pagefind CSS/JS (inline open-handler string literals are OK)
const homeHtml = read('astro/dist/index.html');
const postsHtml = exists('astro/dist/posts/index.html') ? read('astro/dist/posts/index.html') : '';
check(
  !/<link[^>]+href=["'][^"']*pagefind[^"']*["']/i.test(homeHtml),
  'home HTML must not preload pagefind CSS',
);
check(
  !/<script[^>]+src=["'][^"']*pagefind[^"']*["']/i.test(homeHtml),
  'home HTML must not preload pagefind JS',
);
check(/data-search-open/.test(homeHtml), 'search open control missing on home');
check(/data-search-dialog/.test(homeHtml), 'search dialog missing on home');
check(/lang="zh-CN"/.test(homeHtml), 'html lang must be zh-CN for CJK tokenization');
check(/data-profile-home/.test(homeHtml), 'home must render the personal profile');
check(/"@type":"ProfilePage"|"@type":\s*"ProfilePage"/.test(homeHtml), 'home ProfilePage JSON-LD missing');
check(
  /class="brand" href="\/" aria-current="page"/.test(homeHtml),
  'home must mark the Home brand current',
);
check(exists('astro/dist/posts/index.html'), 'missing /posts/ article index');
check(/data-post-index/.test(postsHtml), '/posts/ must render the article index');
check(
  /rel="canonical" href="https:\/\/www\.andy-y\.cn\/posts\/"/.test(postsHtml),
  'bad canonical on /posts/',
);
check(
  /href="\/posts\/" aria-current="page">文章<\/a>/.test(postsHtml),
  '/posts/ must mark the Article navigation item current',
);
const firstPostHref = /<li class="post-card">[\s\S]*?<h2><a href="([^"]+)"/.exec(postsHtml)?.[1];
check(!!firstPostHref, '/posts/ first article link missing');
check(
  !!firstPostHref && homeHtml.includes(`<a href="${firstPostHref}">`),
  'home latest writing must be sourced from the current first article',
);

// Taxonomies + archive + pagination + 404
const meta = JSON.parse(read('data/meta-route-map.json'));
const discoverableMeta = Object.values(meta).filter((item) => item.state === 'active' && item.discoverable !== false);
const hiddenMeta = Object.values(meta).filter((item) => item.state === 'active' && item.discoverable === false);
for (const m of Object.values(meta)) {
  if (m.state !== 'active') continue;
  const rel = path.join('astro/dist', m.canonicalPath.replace(/^\//, ''), 'index.html');
  check(exists(rel), `missing taxonomy page ${m.canonicalPath}`);
  if (exists(rel)) {
    const html = read(rel);
    check(html.includes(`rel="canonical" href="https://www.andy-y.cn${m.canonicalPath}"`), `bad canonical on ${m.canonicalPath}`);
  }
}
check(exists('astro/dist/archive/index.html'), 'missing /archive/');
check(exists('astro/dist/page/2/index.html'), 'missing /page/2/ (expect ≥11 posts)');
check(exists('astro/dist/404.html'), 'missing 404.html');
if (exists('astro/dist/404.html')) {
  const notFoundHtml = read('astro/dist/404.html');
  check(/页面未找到/.test(notFoundHtml), '404.html must render the Astro not-found page');
  check(/name="robots" content="noindex, follow"/.test(notFoundHtml), '404.html must be noindex');
}
if (exists('astro/dist/page/2/index.html')) {
  const pageTwoHtml = read('astro/dist/page/2/index.html');
  check(/href="\/posts\/" rel="prev"/.test(pageTwoHtml), '/page/2/ previous link must return to /posts/');
  check(
    /href="\/posts\/" aria-current="page">文章<\/a>/.test(pageTwoHtml),
    '/page/2/ must keep the Article navigation item current',
  );
}

const lastmod = JSON.parse(read('data/lastmod.json'));
check(!!lastmod['/'], 'lastmod missing /');
check(!!lastmod['/posts/'], 'lastmod missing /posts/');
check(!!lastmod['/archive/'], 'lastmod missing /archive/');
check(!!lastmod['/page/2/'], 'lastmod missing /page/2/');
for (const m of discoverableMeta) {
  check(!!lastmod[m.canonicalPath], `lastmod missing ${m.canonicalPath}`);
}
for (const m of hiddenMeta) {
  check(!lastmod[m.canonicalPath], `hidden taxonomy must not have discovery lastmod ${m.canonicalPath}`);
}

// Sitemap alignment
const sitemapFiles = fs.readdirSync(DIST).filter((f) => /^sitemap.*\.xml$/.test(f));
check(sitemapFiles.length > 0, 'no sitemap xml in dist');
const sitemapBlob = sitemapFiles.map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
const listPaths = ['/', '/posts/', '/archive/', '/page/2/', ...discoverableMeta.map((m) => m.canonicalPath)];
for (const p of listPaths) {
  const loc = `https://www.andy-y.cn${p}`;
  check(sitemapBlob.includes(`<loc>${loc}</loc>`), `sitemap missing ${loc}`);
}
for (const m of hiddenMeta) {
  const loc = `https://www.andy-y.cn${m.canonicalPath}`;
  check(!sitemapBlob.includes(`<loc>${loc}</loc>`), `sitemap must hide ${loc}`);
}
check(!sitemapBlob.includes('/404'), 'sitemap must not include 404');

const archiveHtml = read('astro/dist/archive/index.html');
for (const m of hiddenMeta) {
  check(!archiveHtml.includes(`href="${m.canonicalPath}"`), `archive must hide ${m.canonicalPath}`);
}
check(!archiveHtml.includes("技术fen'x"), 'archive must not expose the broken legacy tag label');

check(/rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/.test(homeHtml), 'home favicon link missing');
check(/rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/.test(homeHtml), 'home touch icon link missing');
check(/rel="manifest" href="\/site\.webmanifest"/.test(homeHtml), 'home webmanifest link missing');
check(/class="card-summary"/.test(postsHtml), 'article list must render generated summaries');
check(/--accent-text:\s*#9a3412/.test(read('astro/src/styles/global.css')), 'accessible light accent text token missing');
check(/\.site-nav a\[aria-current="page"\][\s\S]*?color:\s*var\(--accent-text\)/u.test(read('astro/src/styles/global.css')), 'current navigation must use accessible accent text token');
check(/#waline[\s\S]*?--waline-theme-color:\s*var\(--accent-text\)/u.test(read('astro/src/styles/global.css')), 'Waline must inherit the site accent token');
check(/#waline \.wl-count[\s\S]*?display:\s*none/u.test(read('astro/src/styles/global.css')), 'duplicate Waline count heading must be hidden');

const aboutHtml = read('astro/dist/about/index.html');
check(/目前在做什么/.test(aboutHtml) && /这个站点/.test(aboutHtml), 'About must render the factual profile sections');
check(/<summary[^>]*role="button"[^>]*aria-controls="site-menu-panel"/u.test(aboutHtml), 'mobile menu summary must expose button semantics');
check(/data-site-menu-toggle/u.test(aboutHtml) && /aria-expanded/u.test(aboutHtml), 'mobile menu must synchronize expanded state');
const dn42Html = read('astro/dist/dn42/index.html');
check(/href="https:\/\/lg\.andy-y\.cn"/.test(dn42Html), 'DN42 Looking Glass link missing');
check(/href="https:\/\/flap\.andy-y\.cn"/.test(dn42Html), 'DN42 Flap Alert link missing');
check((dn42Html.match(/<h1(?:\s|>)/gu) || []).length === 1, 'DN42 must contain exactly one h1');
check(/<h2[^>]*>\s*Features\s*<a/u.test(dn42Html), 'DN42 Features must be an h2 without punctuation');
check(/<h2[^>]*>\s*Contact\s*<a/u.test(dn42Html), 'DN42 Contact must be an h2');
check(!/<h[2-6][^>]*>[^<]*#\s*<a/gu.test(dn42Html), 'DN42 headings must not retain closing hash markers');

const postSources = fs.readdirSync(path.join(ROOT, 'astro', 'src', 'content', 'posts')).filter((name) => name.endsWith('.md'));
for (const source of postSources) {
  const markdown = fs.readFileSync(path.join(ROOT, 'astro', 'src', 'content', 'posts', source), 'utf8');
  const description = /^description:\s*(.+)$/mu.exec(markdown)?.[1]?.trim() || '';
  check(description.length >= 24, `${source} missing generated description`);
  check(!/[`<>\[\]]/u.test(description), `${source} description contains markup`);
}

// Chinese / known content present in Pagefind fragments (gzip-compressed)
const pfDir = path.join(DIST, 'pagefind');
function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const full = path.join(dir, ent.name);
    return ent.isDirectory() ? walkFiles(full) : [full];
  });
}
let indexBlob = '';
for (const f of walkFiles(path.join(pfDir, 'fragment'))) {
  const raw = fs.readFileSync(f);
  try {
    indexBlob += zlib.gunzipSync(raw).toString('utf8');
  } catch {
    indexBlob += raw.toString('utf8');
  }
}
check(/Typecho|Grafana|Silly|Asterisk/.test(indexBlob), 'pagefind index lacks expected content tokens');
if (exists('astro/dist/pagefind/pagefind-entry.json')) {
  const entry = JSON.parse(read('astro/dist/pagefind/pagefind-entry.json'));
  check(entry.languages?.['zh-cn']?.page_count === 15, 'pagefind should index 15 content pages');
}

// data-pagefind-body on a known post
if (exists('astro/dist/posts/typecho-joe-mermaid/index.html')) {
  const samplePost = read('astro/dist/posts/typecho-joe-mermaid/index.html');
  check(/data-pagefind-body/.test(samplePost), 'posts must declare data-pagefind-body');
}

const report = {
  ok: failures.length === 0,
  failures,
  pagefindFiles: walkFiles(pfDir).length,
  lastmodKeys: Object.keys(lastmod).length,
  taxonomyPages: Object.values(meta).filter((m) => m.state === 'active').length,
  discoverableTaxonomyPages: discoverableMeta.length,
};
fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs/baselines/reports/stage6-gates.md'),
  [
    '# Stage 6 gates',
    '',
    `**Result:** ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    `- Pagefind artifacts: ${report.pagefindFiles} files under dist/pagefind`,
    `- lastmod keys: ${report.lastmodKeys}`,
    `- active taxonomy pages: ${report.taxonomyPages}`,
    `- discoverable taxonomy pages: ${report.discoverableTaxonomyPages}`,
    `- Lazy UI: home HTML has zero pagefind-ui / pagefind.js references`,
    `- Personal home + /posts/ + taxonomies + /archive/ + /page/2/ + 404.html present`,
    `- Sitemap includes discoverable list canonicals with lastmod; excludes compatibility-only taxonomies and 404`,
    '',
    failures.length ? '## Failures\n\n' + failures.map((f) => `- ${f}`).join('\n') : '## Failures\n\n(none)',
    '',
  ].join('\n'),
);

if (failures.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report));
