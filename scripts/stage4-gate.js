/**
 * Stage 4 static gates: legacy map, nginx 302, RSS lastmod, SEO tags, RSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'astro', 'dist');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const legacy = readJson('data/legacy-url-map.json');
const routeMap = readJson('data/route-map.json');
const lastmod = readJson('data/lastmod.json');
const nginx = read('nginx/release-http.conf');
const manifest = readJson('nginx/release-manifest.json');

check(Array.isArray(legacy) && legacy.length > 0, 'legacy-url-map empty');
check(manifest.redirectStatus === 302, `expected observation 302, got ${manifest.redirectStatus}`);
check(nginx.includes('return 302 https://www.andy-y.cn$legacy_target'), 'nginx missing path 302');
check(nginx.includes('return 302 https://www.andy-y.cn$legacy_query_target'), 'nginx missing query 302');
check(!nginx.includes('return 301 https://www.andy-y.cn$legacy_target'), 'observation nginx must not use 301 for legacy');

const pathKeys = new Set();
const queryKeys = new Set();
for (const entry of legacy) {
  check(['redirect', 'not_found', 'gone'].includes(entry.action), `bad action ${entry.action}`);
  if (entry.action === 'redirect') {
    check(!!entry.targetPath?.startsWith('/'), `redirect without target: ${JSON.stringify(entry)}`);
    if (entry.oldPath) {
      check(
        entry.oldPath !== entry.targetPath,
        `self-redirect forbidden: ${entry.oldPath} → ${entry.targetPath}`,
      );
    }
  }
  if (entry.queryKey) {
    check(!queryKeys.has(entry.queryKey), `duplicate queryKey ${entry.queryKey}`);
    queryKeys.add(entry.queryKey);
    check(/^\S+:\d+$/.test(entry.queryKey), `bad queryKey shape ${entry.queryKey}`);
  } else {
    check(!!entry.oldPath, 'entry missing oldPath');
    check(!pathKeys.has(entry.oldPath), `duplicate oldPath ${entry.oldPath}`);
    pathKeys.add(entry.oldPath);
  }
}

// Nginx map must not contain self-redirects either (defense in depth).
for (const m of nginx.matchAll(/"([^"]+)"\s+"([^"]+)";/g)) {
  const [, from, to] = m;
  if (from.startsWith('/') && to.startsWith('/') && from === to) {
    check(false, `nginx self-redirect: ${from}`);
  }
}

// Documented query keys only on / and /index.php
for (const key of queryKeys) {
  const host = key.split(':')[0];
  check(host === '/' || host === '/index.php', `query key host not allowlisted: ${key}`);
}

// Sample known redirects present
const must = [
  '/index.php/archives/13/',
  '/archives/13/',
  '/index.php/feed/',
  '/index.php/start-page.html',
];
for (const p of must) {
  check(pathKeys.has(p), `missing legacy path ${p}`);
}
check(queryKeys.has('/:13') && queryKeys.has('/index.php:13'), 'missing ?p=13 query keys');

// Active content routes must have lastmod
for (const route of Object.values(routeMap)) {
  if (route.state !== 'active') continue;
  check(!!lastmod[route.canonicalPath], `missing lastmod for ${route.canonicalPath}`);
}
check(!!lastmod['/'], 'missing lastmod for /');

// Dist checks
const rss = fs.readFileSync(path.join(DIST, 'rss.xml'), 'utf8');
check(rss.includes('<guid isPermaLink="false">'), 'rss missing custom guid');
check(fs.existsSync(path.join(DIST, 'robots.txt')), 'robots.txt missing');
check(
  fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8').includes('Sitemap: https://www.andy-y.cn/sitemap-index.xml'),
  'robots.txt missing sitemap line',
);
const sitemapFiles = fs.readdirSync(DIST).filter((n) => /^sitemap-\d+\.xml$/.test(n));
const sitemapXml = sitemapFiles.map((n) => fs.readFileSync(path.join(DIST, n), 'utf8')).join('\n');
check(sitemapXml.includes('<lastmod>'), 'sitemap has no lastmod');
check(fs.existsSync(path.join(DIST, 'sitemap-index.xml')), 'sitemap-index.xml missing');
check(fs.existsSync(path.join(DIST, 'og-default.png')), 'og-default.png missing');

// Every active canonical appears in sitemap; every sitemap URL has lastmod.
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const sitemapBlocks = [...sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
for (const block of sitemapBlocks) {
  const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
  const lm = /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1];
  check(!!lm, `sitemap entry without lastmod: ${loc}`);
}

for (const route of Object.values(routeMap)) {
  if (route.state !== 'active') continue;
  const abs = `https://www.andy-y.cn${route.canonicalPath}`;
  check(sitemapUrls.includes(abs), `sitemap missing ${abs}`);
}
check(sitemapUrls.includes('https://www.andy-y.cn/'), 'sitemap missing home');

// HTML SEO sample
const postHtml = fs.readFileSync(
  path.join(DIST, 'posts', 'maibot-astrbot-napcat', 'index.html'),
  'utf8',
);
check(postHtml.includes('rel="canonical" href="https://www.andy-y.cn/posts/maibot-astrbot-napcat/"'), 'canonical mismatch');
check(postHtml.includes('property="og:image"'), 'og:image missing');
check(postHtml.includes('name="twitter:card" content="summary_large_image"'), 'twitter card missing');
check(postHtml.includes('application/ld+json'), 'json-ld missing');
check(postHtml.includes('"@type":"BlogPosting"') || postHtml.includes('"@type": "BlogPosting"'), 'BlogPosting ld missing');

// Ensure JSON-LD is real JSON (set:html), not literal {title}
check(!postHtml.includes('"{title}"'), 'json-ld not interpolated');

if (failures.length) {
  console.error('Stage 4 gates failed:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      legacyEntries: legacy.length,
      pathRedirects: pathKeys.size,
      queryRedirects: queryKeys.size,
      sitemapUrls: sitemapUrls.length,
      lastmodKeys: Object.keys(lastmod).length,
    },
    null,
    2,
  ),
);
