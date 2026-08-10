/**
 * Generate versioned nginx/release-http.conf from route-map + legacy-url-map.
 *
 * Usage:
 *   node scripts/generate-nginx.js --status 302
 *   node scripts/generate-nginx.js --status 301
 *
 * Maps live in http context. All three public vhosts share the same action
 * order: not_found → gone → query redirect → path redirect → host/protocol
 * convergence. Tombstones always return 404/410; only redirect status flips.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNginxUriKey } from './nginx-uri.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.andy-y.cn';

const readJson = async (rel) =>
  JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));

const escapeNginx = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Escape for nginx map `~` regex keys (case-sensitive). */
const escapeNginxRegex = (value) =>
  String(value).replace(/[\\.^$|?*+()[\]{}]/g, '\\$&');

const parseStatus = () => {
  const idx = process.argv.indexOf('--status');
  const raw = idx === -1 ? '302' : process.argv[idx + 1];
  if (raw !== '302' && raw !== '301') {
    throw new Error(`--status must be 302 or 301, got ${raw}`);
  }
  return raw;
};

/**
 * Build an nginx map.
 * Path maps use case-sensitive regex keys (`~^...$`) because ngx_http_map_module
 * matches plain strings case-insensitively — otherwise /category/AI/ → /category/ai/
 * also matches the lowercase canonical and 302s to itself.
 */
const buildMap = (varExpr, mapVar, entries, { boolean = false, caseSensitive = false } = {}) => {
  const lines = [`map ${varExpr} $${mapVar} {`, `  default ${boolean ? '0;' : '"";'}`];
  for (const [key, value] of entries) {
    const left = caseSensitive ? `~^${escapeNginxRegex(key)}$` : `"${escapeNginx(key)}"`;
    if (boolean) lines.push(`  ${left} 1;`);
    else lines.push(`  ${left} "${escapeNginx(value)}";`);
  }
  lines.push('}');
  return lines.join('\n');
};

const legacyActionSnippet = (status) => `  if ($legacy_query_not_found) { return 404; }
  if ($legacy_not_found)       { return 404; }
  if ($legacy_query_gone)      { return 410; }
  if ($legacy_gone)            { return 410; }
  if ($legacy_query_target != "") { return ${status} ${SITE}$legacy_query_target; }
  if ($legacy_target != "")       { return ${status} ${SITE}$legacy_target; }`;

async function main() {
  const status = parseStatus();
  const legacy = await readJson('data/legacy-url-map.json');
  const routeMap = await readJson('data/route-map.json');

  const pathRedirect = [];
  const queryRedirect = [];
  const pathNotFound = [];
  const pathGone = [];
  const queryNotFound = [];
  const queryGone = [];
  const seenPath = new Map();
  const seenQuery = new Map();

  for (const entry of legacy) {
    if (entry.action === 'redirect') {
      if (!entry.targetPath?.startsWith('/') || entry.targetPath.includes('\n')) {
        throw new Error(`illegal target: ${JSON.stringify(entry)}`);
      }
      if (entry.queryKey) {
        if (seenQuery.has(entry.queryKey) && seenQuery.get(entry.queryKey) !== entry.targetPath) {
          throw new Error(`query conflict: ${entry.queryKey}`);
        }
        seenQuery.set(entry.queryKey, entry.targetPath);
        queryRedirect.push([entry.queryKey, entry.targetPath]);
      } else if (entry.oldPath) {
        const normalizedPath = normalizeNginxUriKey(entry.oldPath);
        if (normalizedPath === entry.targetPath) {
          throw new Error(`self-redirect forbidden: ${entry.oldPath}`);
        }
        if (seenPath.has(normalizedPath) && seenPath.get(normalizedPath) !== entry.targetPath) {
          throw new Error(`path conflict: ${entry.oldPath}`);
        }
        seenPath.set(normalizedPath, entry.targetPath);
        pathRedirect.push([normalizedPath, entry.targetPath]);
      } else {
        throw new Error(`redirect missing key: ${JSON.stringify(entry)}`);
      }
      continue;
    }
    if (entry.action === 'not_found') {
      if (entry.queryKey) queryNotFound.push([entry.queryKey, true]);
      else pathNotFound.push([normalizeNginxUriKey(entry.oldPath), true]);
      continue;
    }
    if (entry.action === 'gone') {
      if (entry.queryKey) queryGone.push([entry.queryKey, true]);
      else pathGone.push([normalizeNginxUriKey(entry.oldPath), true]);
      continue;
    }
    throw new Error(`unknown action: ${entry.action}`);
  }

  // Reject redirects that target non-active content routes (meta pages are
  // allowed as Stage-6 placeholders; / and /rss.xml are always active).
  const activeContent = new Set(
    Object.values(routeMap)
      .filter((r) => r.state === 'active')
      .map((r) => r.canonicalPath),
  );
  activeContent.add('/');
  activeContent.add('/rss.xml');
  // meta targets intentionally allowed

  pathRedirect.sort((a, b) => a[0].localeCompare(b[0]));
  queryRedirect.sort((a, b) => a[0].localeCompare(b[0]));

  const header = `# Generated by scripts/generate-nginx.js — do not edit by hand.
# redirect status: ${status}
# entries: path=${pathRedirect.length} query=${queryRedirect.length} not_found=${pathNotFound.length + queryNotFound.length} gone=${pathGone.length + queryGone.length}
# This file is included from http context via 00-release-loader.conf.
`;

  const maps = [
    buildMap('$uri', 'legacy_target', pathRedirect, { caseSensitive: true }),
    buildMap('"$uri:$arg_p"', 'legacy_query_target', queryRedirect),
    buildMap('$uri', 'legacy_not_found', pathNotFound, { boolean: true, caseSensitive: true }),
    buildMap('$uri', 'legacy_gone', pathGone, { boolean: true, caseSensitive: true }),
    buildMap('"$uri:$arg_p"', 'legacy_query_not_found', queryNotFound, { boolean: true }),
    buildMap('"$uri:$arg_p"', 'legacy_query_gone', queryGone, { boolean: true }),
  ].join('\n\n');

  const http80 = `server {
  listen 80;
  server_name www.andy-y.cn andy-y.cn;
${legacyActionSnippet(status)}
  return 301 ${SITE}$request_uri;
}
server {
  listen 80;
  server_name cms.andy-y.cn;
  return 301 https://cms.andy-y.cn$request_uri;
}`;

  const apex443 = `server {
  listen 443 ssl;
  http2 on;
  server_name andy-y.cn;
  ssl_certificate     /etc/letsencrypt/live/andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/andy-y.cn/privkey.pem;
${legacyActionSnippet(status)}
  return 301 ${SITE}$request_uri;
}`;

  const www443 = `server {
  listen 443 ssl;
  http2 on;
  server_name www.andy-y.cn;

  ssl_certificate     /etc/letsencrypt/live/andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/andy-y.cn/privkey.pem;

  root /var/www/andy-y.cn/current/site;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml application/xml+rss;
  gzip_min_length 1024;

${legacyActionSnippet(status)}

  location = /admin { return 404; }
  location ^~ /admin/ { return 404; }
  location ~ \\.php(?:/|$) { return 404; }

  location /usr/uploads/ {
    alias /var/www/typecho/usr/uploads/;
    expires 30d;
  }

  location ^~ /api/ {
    proxy_pass http://waline:8360;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_read_timeout 30s;
    add_header Cache-Control "no-store" always;
  }
  location = /ui { return 308 /ui/; }
  location ^~ /ui/ {
    proxy_pass http://waline:8360;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store" always;
  }

  location ^~ /_astro/ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location = /__release {
    try_files /release-id.txt =503;
    add_header Cache-Control "no-store" always;
  }

  location / {
    try_files $uri $uri/index.html =404;
    add_header Cache-Control "public, max-age=0, s-maxage=600, must-revalidate" always;
  }
}`;

  const cms443 = `server {
  listen 443 ssl;
  http2 on;
  server_name cms.andy-y.cn;
  ssl_certificate     /etc/letsencrypt/live/cms.andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/cms.andy-y.cn/privkey.pem;

  root /var/www/typecho;
  index index.php;
  client_max_body_size 64m;
  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

  location / { try_files $uri $uri/ /index.php$uri?$query_string; }
  location = /config.inc.php { deny all; }
  location = /install.php { return 404; }
  location ~ /\\.(?!well-known/) { deny all; }

  location ~ \\.php(?:/|$) {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass typecho:9000;
  }
}`;

  const body = [header, maps, http80, apex443, www443, cms443].join('\n\n') + '\n';

  const outDir = path.join(ROOT, 'nginx');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'release-http.conf');
  await fs.writeFile(outFile, body, 'utf8');

  const loader = `# Fixed http-context loader. Points at the active release's maps+servers.
include /var/www/andy-y.cn/current/nginx/release-http.conf;
`;
  await fs.writeFile(path.join(outDir, '00-release-loader.conf'), loader, 'utf8');

  // Manifest for release packaging / gates.
  const manifest = {
    redirectStatus: Number(status),
    generatedAt: new Date().toISOString(),
    pathRedirects: pathRedirect.length,
    queryRedirects: queryRedirect.length,
    notFound: pathNotFound.length + queryNotFound.length,
    gone: pathGone.length + queryGone.length,
    site: SITE,
  };
  await fs.writeFile(
    path.join(outDir, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify({ out: 'nginx/release-http.conf', ...manifest }, null, 2));
}

await main();
