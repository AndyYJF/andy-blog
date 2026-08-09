import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const domain = arg('--domain', 'cms.andy-y.cn');
const upstream = arg('--upstream', '127.0.0.1:8080');
const certDir = arg('--cert-dir', '/www/sites/www.andy-y.cn/ssl');
const authFile = arg('--auth-file', '/www/server/pass/andy-blog-cms.htpasswd');
const output = path.resolve(ROOT, arg('--out', '.cache/stage10-nginx/cms.andy-y.cn.conf'));

if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('invalid domain');
if (!/^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(upstream)) throw new Error('upstream must be loopback');
for (const value of [certDir, authFile]) {
  if (!path.posix.isAbsolute(value)) throw new Error('cert-dir and auth-file must be absolute POSIX paths');
}

const config = `server {
  listen 80;
  server_name ${domain};
  return 302 https://${domain}$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${domain};
  ssl_certificate ${certDir}/fullchain.pem;
  ssl_certificate_key ${certDir}/privkey.pem;
  client_max_body_size 64m;

  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
  add_header Cache-Control "private, no-store" always;
  auth_basic "Andy Blog CMS";
  auth_basic_user_file ${authFile};

  location ~ /\\. { return 404; }
  location ~ ^/(?:config\\.inc\\.php|install\\.php|upgrade\\.php)(?:/|$) { return 404; }

  location / {
    proxy_pass http://${upstream};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 120s;
  }
}
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, config, 'utf8');
console.log(JSON.stringify({ domain, upstream, output: path.relative(ROOT, output) }));
