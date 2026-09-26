/**
 * Emit a self-contained www cutover HTTP snippet (maps + apex/www servers)
 * for Stage 10 production switch. Used by Compose nginx include or adapted
 * for 1Panel OpenResty via generate-1panel-www-nginx.js.
 *
 * Does NOT include cms.andy-y.cn (separate CMS cutover). First cut keeps
 * Typecho reachable only via existing cms/admin path until CMS vhost is ready.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNginxUriKey } from './nginx-uri.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.andy-y.cn';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const statusRaw = arg('--status') || '302';
const status = Number(statusRaw);
if (status !== 302 && status !== 301) throw new Error('--status must be 302 or 301');

const outPath = path.resolve(ROOT, arg('--out') || '.cache/stage10-nginx/www-cutover-http.conf');
const siteRoot = arg('--site-root') || '/var/www/andy-y.cn/current/site';
const uploadsAlias = arg('--uploads-alias') || '/var/www/typecho/usr/uploads/';
const walineUpstream = arg('--waline-upstream') || 'waline:8360';
const certFullchain = arg('--cert-fullchain') || '/etc/letsencrypt/live/andy-y.cn/fullchain.pem';
const certKey = arg('--cert-key') || '/etc/letsencrypt/live/andy-y.cn/privkey.pem';

const escapeNginx = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const escapeNginxRegex = (value) => String(value).replace(/[\\.^$|?*+()[\]{}]/g, '\\$&');

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

const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/legacy-url-map.json'), 'utf8'));
const pathRedirect = [];
const queryRedirect = [];
const pathNotFound = [];
const pathGone = [];
const queryNotFound = [];
const queryGone = [];

for (const entry of legacy) {
  if (entry.action === 'redirect') {
    if (entry.queryKey) queryRedirect.push([entry.queryKey, entry.targetPath]);
    else if (entry.oldPath) pathRedirect.push([normalizeNginxUriKey(entry.oldPath), entry.targetPath]);
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
  }
}

pathRedirect.sort((a, b) => a[0].localeCompare(b[0]));
queryRedirect.sort((a, b) => a[0].localeCompare(b[0]));

const maps = [
  buildMap('$uri', 'legacy_target', pathRedirect, { caseSensitive: true }),
  buildMap('"$uri:$arg_p"', 'legacy_query_target', queryRedirect),
  buildMap('$uri', 'legacy_not_found', pathNotFound, { boolean: true, caseSensitive: true }),
  buildMap('$uri', 'legacy_gone', pathGone, { boolean: true, caseSensitive: true }),
  buildMap('"$uri:$arg_p"', 'legacy_query_not_found', queryNotFound, { boolean: true }),
  buildMap('"$uri:$arg_p"', 'legacy_query_gone', queryGone, { boolean: true }),
].join('\n\n');

// Public Waline is Cache-Control: no-store and always hits origin. Key by CDN
// client IP headers (Aliyun / Cloudflare) then leftmost XFF, not the edge hop.
const walineRateLimitMaps = `map $http_ali_cdn_real_ip $waline_rl_ali {
  default "";
  "~*^([0-9a-fA-F.:]+)$" $1;
}

map $http_cf_connecting_ip $waline_rl_cf {
  default "";
  "~*^([0-9a-fA-F.:]+)$" $1;
}

map $http_x_forwarded_for $waline_rl_xff {
  default "";
  "~*^([0-9a-fA-F.:]+)" $1;
}

map "$waline_rl_ali:$waline_rl_cf:$waline_rl_xff" $waline_rl_key {
  default $remote_addr;
  "~*^([0-9a-fA-F.:]+):" $1;
  "~*^:([0-9a-fA-F.:]+):" $1;
  "~*^::([0-9a-fA-F.:]+)$" $1;
}

# ~1 req / 3s sustained; burst covers a normal comment widget load.
limit_req_zone $waline_rl_key zone=waline_api:10m rate=20r/m;`;

const legacyAction = `  if ($legacy_query_not_found) { return 404; }
  if ($legacy_not_found)       { return 404; }
  if ($legacy_query_gone)      { return 410; }
  if ($legacy_gone)            { return 410; }
  if ($legacy_query_target != "") { return ${status} ${SITE}$legacy_query_target; }
  if ($legacy_target != "")       { return ${status} ${SITE}$legacy_target; }`;

// Pagefind compiles WASM in-page; Chrome requires 'wasm-unsafe-eval' when 'unsafe-eval' is absent.
const WWW_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://umami.andy-y.cn https://challenges.cloudflare.com; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://umami.andy-y.cn https://ipwho.is https://build2.fei.cx https://challenges.cloudflare.com; frame-src https://player.bilibili.com https://music.163.com https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";

const wwwSecurityHeaders = (indent = '  ') =>
  [
    'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;',
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "DENY" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    `add_header Content-Security-Policy "${WWW_CSP}" always;`,
  ]
    .map((line) => `${indent}${line}`)
    .join('\n');

const body = `# Generated by scripts/generate-www-cutover-http.js — do not edit by hand.
# Stage 10 production www cutover (redirect-status=${status}).
# path=${pathRedirect.length} query=${queryRedirect.length}

${maps}

${walineRateLimitMaps}

server {
  listen 80;
  server_name www.andy-y.cn andy-y.cn;
${legacyAction}
  return 301 ${SITE}$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name andy-y.cn;
  ssl_certificate     ${certFullchain};
  ssl_certificate_key ${certKey};
${legacyAction}
  return 301 ${SITE}$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name www.andy-y.cn;

  ssl_certificate     ${certFullchain};
  ssl_certificate_key ${certKey};

  root ${siteRoot};

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml application/xml+rss;
  gzip_min_length 1024;

${wwwSecurityHeaders()}

${legacyAction}

  location = /admin { return 404; }
  location ^~ /admin/ { return 404; }
  location ~ \\.php(?:/|$) { return 404; }
  location ~ /\\.(?!well-known/) { deny all; }

  location /usr/uploads/ {
    alias ${uploadsAlias};
    expires 30d;
  }

  location ^~ /api/ {
    limit_req zone=waline_api burst=20 nodelay;
    limit_req_status 429;
    proxy_pass http://${walineUpstream};
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
    proxy_pass http://${walineUpstream};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store" always;
  }

  # Pagefind WASM ships as *.pagefind; browsers need application/wasm for instantiateStreaming.
  location ^~ /pagefind/ {
    location ~* \\.pagefind$ {
      default_type application/wasm;
      try_files $uri =404;
      add_header Cache-Control "public, max-age=0, s-maxage=600, must-revalidate" always;
${wwwSecurityHeaders('      ')}
    }
    try_files $uri =404;
    add_header Cache-Control "public, max-age=0, s-maxage=600, must-revalidate" always;
${wwwSecurityHeaders('    ')}
  }

  location ^~ /_astro/ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
${wwwSecurityHeaders('    ')}
  }

  location = /__release {
    try_files /release-id.txt =503;
    add_header Cache-Control "no-store" always;
  }

  error_page 404 /404.html;
  location = /404.html {
    internal;
    try_files /404.html =500;
    add_header Cache-Control "no-store" always;
    add_header X-Robots-Tag "noindex, follow" always;
${wwwSecurityHeaders('    ')}
  }

  location / {
    try_files $uri $uri/index.html =404;
    add_header Cache-Control "public, max-age=0, s-maxage=600, must-revalidate" always;
${wwwSecurityHeaders('    ')}
  }
}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body, 'utf8');
console.log(
  JSON.stringify({
    out: path.relative(ROOT, outPath),
    status,
    siteRoot,
    walineUpstream,
    redirects: pathRedirect.length + queryRedirect.length,
  }),
);
