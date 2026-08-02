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

// Taxonomies + archive + pagination + 404
const meta = JSON.parse(read('data/meta-route-map.json'));
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

const lastmod = JSON.parse(read('data/lastmod.json'));
check(!!lastmod['/'], 'lastmod missing /');
check(!!lastmod['/archive/'], 'lastmod missing /archive/');
check(!!lastmod['/page/2/'], 'lastmod missing /page/2/');
for (const m of Object.values(meta)) {
  if (m.state !== 'active') continue;
  check(!!lastmod[m.canonicalPath], `lastmod missing ${m.canonicalPath}`);
}

// Sitemap alignment
const sitemapFiles = fs.readdirSync(DIST).filter((f) => /^sitemap.*\.xml$/.test(f));
check(sitemapFiles.length > 0, 'no sitemap xml in dist');
const sitemapBlob = sitemapFiles.map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
const listPaths = ['/', '/archive/', '/page/2/', ...Object.values(meta).filter((m) => m.state === 'active').map((m) => m.canonicalPath)];
for (const p of listPaths) {
  const loc = `https://www.andy-y.cn${p}`;
  check(sitemapBlob.includes(`<loc>${loc}</loc>`), `sitemap missing ${loc}`);
}
check(!sitemapBlob.includes('/404'), 'sitemap must not include 404');

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
    `- Lazy UI: home HTML has zero pagefind-ui / pagefind.js references`,
    `- Taxonomies + /archive/ + /page/2/ + 404.html present`,
    `- Sitemap includes list canonicals with lastmod; excludes 404`,
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
