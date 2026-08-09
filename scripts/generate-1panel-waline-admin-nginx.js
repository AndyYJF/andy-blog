import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const domain = arg('--domain', 'comments.andy-y.cn');
const upstream = arg('--upstream', '127.0.0.1:8362');
const publicServerUrl = arg('--public-server-url', 'https://www.andy-y.cn');
const certDir = arg('--cert-dir', '/www/sites/www.andy-y.cn/ssl');
const output = path.resolve(ROOT, arg('--out', '.cache/stage10-nginx/comments.andy-y.cn.conf'));

if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('invalid domain');
if (!/^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(upstream)) throw new Error('upstream must be loopback');
if (!/^https:\/\/[a-z0-9.-]+$/.test(publicServerUrl)) throw new Error('public-server-url must be an HTTPS origin');
if (!path.posix.isAbsolute(certDir)) throw new Error('cert-dir must be an absolute POSIX path');

const proxy = `
    proxy_pass http://${upstream};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";`;

const config = `map "$request_method:$http_authorization" $andy_blog_comments_block_unauthenticated_write {
  default 0;
  ~*^(POST|PUT|PATCH|DELETE):(?!Bearer\\s) 1;
}

server {
  listen 80;
  server_name ${domain};
  return 302 https://${domain}$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${domain};
  ssl_certificate ${certDir}/fullchain.pem;
  ssl_certificate_key ${certDir}/privkey.pem;

  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
  add_header Cache-Control "private, no-store" always;

  location = / { return 302 /ui/; }
  location ^~ /ui/ {
    # The shared Waline instance advertises the public www API. Repoint only
    # the admin UI to this management origin.
    proxy_set_header Accept-Encoding "";
    sub_filter_once off;
    sub_filter "window.serverURL = '${publicServerUrl}/api/';" "window.serverURL = 'https://${domain}/api/';";${proxy}
  }
  # Waline owns authentication on the management origin. Keep token login
  # available, permanently reject user registration, and require Bearer for
  # every other state-changing API request.
  location = /api/token {${proxy}
  }
  location ^~ /api/user {
    if ($request_method = POST) { return 403; }${proxy}
  }
  location ^~ /api/ {
    if ($andy_blog_comments_block_unauthenticated_write) { return 403; }${proxy}
  }
  location / { return 404; }
}
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, config, 'utf8');
console.log(JSON.stringify({ domain, upstream, output: path.relative(ROOT, output) }));
