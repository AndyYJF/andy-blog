/**
 * Adapt generated www-cutover-http.conf to 1Panel OpenResty host-network paths.
 * Mirrors generate-1panel-staging-nginx.js for production www.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const input = path.resolve(ROOT, arg('--input') || '.cache/stage10-nginx/www-cutover-http.conf');
const output = path.resolve(ROOT, arg('--out') || '.cache/stage10-nginx/www.andy-y.cn.conf');
const siteRoot = arg('--site-root') || '/www/sites/www.andy-y.cn/deploy/current/site';
const uploadsAlias = arg('--uploads-alias') || '/opt/1panel/apps/typecho/typecho/data/usr/uploads/';
const certDir = arg('--cert-dir') || '/www/sites/www.andy-y.cn/ssl';
const walineUpstream = arg('--waline-upstream') || '127.0.0.1:8360';

if (!path.posix.isAbsolute(siteRoot) || !path.posix.isAbsolute(certDir) || !path.posix.isAbsolute(uploadsAlias)) {
  throw new Error('site-root, cert-dir, and uploads-alias must be absolute POSIX paths');
}
if (!/^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(walineUpstream)) {
  throw new Error('waline-upstream must be loopback host:port');
}

let config = fs.readFileSync(input, 'utf8');

const replacements = [
  ['/etc/letsencrypt/live/andy-y.cn/fullchain.pem', `${certDir}/fullchain.pem`],
  ['/etc/letsencrypt/live/andy-y.cn/privkey.pem', `${certDir}/privkey.pem`],
  ['root /var/www/andy-y.cn/current/site;', `root ${siteRoot};\n  access_log /www/sites/www.andy-y.cn/log/access.log main;\n  error_log /www/sites/www.andy-y.cn/log/error.log;`],
  ['alias /var/www/typecho/usr/uploads/;', `alias ${uploadsAlias};`],
  ['proxy_pass http://waline:8360;', `proxy_pass http://${walineUpstream};`],
];

for (const [from, to] of replacements) {
  const count = config.split(from).length - 1;
  if (count < 1) throw new Error(`expected at least 1 occurrence of ${from}, got ${count}`);
  config = config.replaceAll(from, to);
}

if (!config.includes('server_name www.andy-y.cn;')) throw new Error('missing www server');
if (!config.includes(`root ${siteRoot};`)) throw new Error('site root not adapted');
if (config.includes('proxy_pass http://waline:8360') || config.includes('/etc/letsencrypt/live/andy-y.cn')) {
  throw new Error('unadapted production references remain');
}
const noindexHeaders = config.match(/add_header X-Robots-Tag "noindex[^"\r\n]*" always;/g) || [];
if (
  noindexHeaders.length !== 1
  || noindexHeaders[0] !== 'add_header X-Robots-Tag "noindex, follow" always;'
  || !config.includes('error_page 404 /404.html;')
) {
  throw new Error('production www may carry only the exact custom-404 noindex header');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, config, 'utf8');
console.log(
  JSON.stringify({
    input: path.relative(ROOT, input),
    output: path.relative(ROOT, output),
    siteRoot,
    certDir,
    walineUpstream,
    uploadsAlias,
  }),
);
