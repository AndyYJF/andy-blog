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

// Nginx map must not contain quoted-string self-redirects.
for (const m of nginx.matchAll(/"([^"]+)"\s+"([^"]+)";/g)) {
  const [, from, to] = m;
  if (from.startsWith('/') && to.startsWith('/') && from === to) {
    check(false, `nginx self-redirect: ${from}`);
  }
}

/** Decode nginx `~^literal$` map keys produced by generate-nginx.js (escaped literals only). */
const decodeAnchoredLiteral = (key) => {
  if (!key.startsWith('~^') || !key.endsWith('$')) return null;
  const body = key.slice(2, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && i + 1 < body.length) {
      i += 1;
      out += body[i];
    } else {
      out += body[i];
    }
  }
  // Reject non-literal patterns (wildcards / groups). Paths may contain '.'.
  if (/[*+?|()[\]{}^$]/.test(out)) return null;
  if (!out.startsWith('/')) return null;
  return out;
};

// Path legacy map must use case-sensitive regex keys (~^...$). Plain strings
// are matched case-insensitively by ngx_http_map_module and turn
// /category/AI/ → /category/ai/ into a self-redirect for /category/ai/.
const legacyTargetMatch = /map \$uri \$legacy_target \{([\s\S]*?)\n\}/.exec(nginx);
check(!!legacyTargetMatch, 'missing map $uri $legacy_target');
const nginxPathRedirects = new Map();
if (legacyTargetMatch) {
  const block = legacyTargetMatch[1];
  const pathLines = [...block.matchAll(/^\s+(\S+)\s+"(\/[^"]*)";$/gm)];
  check(pathLines.length > 0, 'legacy_target has no path redirect entries');
  for (const [, left, to] of pathLines) {
    check(left.startsWith('~^') && left.endsWith('$'), `legacy_target key must be case-sensitive regex: ${left}`);
    const literal = decodeAnchoredLiteral(left);
    check(!!literal, `legacy_target key is not an anchored literal: ${left}`);
    if (!literal) continue;
    check(literal !== to, `regex-self redirect forbidden: ${left} → ${to}`);
    check(!nginxPathRedirects.has(literal), `duplicate nginx path literal ${literal}`);
    nginxPathRedirects.set(literal, to);
  }
  // Negative matrix: lowercase canonicals must not appear as plain quoted keys
  for (const canon of ['/category/ai/', '/category/dn42/', '/category/nas/']) {
    check(
      !new RegExp(`^\\s+"${canon.replace(/\//g, '\\/')}"\\s+`, 'm').test(block),
      `legacy_target must not use case-insensitive string key for canonical ${canon}`,
    );
    // Also reject regex-self for these canonicals specifically
    check(
      nginxPathRedirects.get(canon) !== canon,
      `canonical must not regex-self-redirect: ${canon}`,
    );
  }
}

// Nginx path redirects must match legacy-url-map redirect entries 1:1.
const legacyPathRedirects = legacy.filter((e) => e.action === 'redirect' && e.oldPath);
check(
  nginxPathRedirects.size === legacyPathRedirects.length,
  `nginx path redirects (${nginxPathRedirects.size}) != legacy path redirects (${legacyPathRedirects.length})`,
);
for (const entry of legacyPathRedirects) {
  const got = nginxPathRedirects.get(entry.oldPath);
  check(got != null, `nginx missing legacy path ${entry.oldPath}`);
  check(got === entry.targetPath, `nginx target drift for ${entry.oldPath}: ${got} vs ${entry.targetPath}`);
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
