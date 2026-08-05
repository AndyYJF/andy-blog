/**
 * Adapt the generated new.andy-y.cn staging config to the existing 1Panel
 * OpenResty host-network container. The default generator remains unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const input = path.resolve(ROOT, arg('--input') || '.cache/stage9-nginx/staging-http.conf');
const output = path.resolve(ROOT, arg('--out') || '.cache/stage9-nginx/new.andy-y.cn.conf');
const siteRoot = arg('--site-root') || '/www/sites/new.andy-y.cn/deploy/candidate/site';
const certDir = arg('--cert-dir') || '/www/sites/www.andy-y.cn/ssl';
const walineUpstream = arg('--waline-upstream') || '127.0.0.1:8361';

if (!path.posix.isAbsolute(siteRoot) || !path.posix.isAbsolute(certDir)) {
  throw new Error('site-root and cert-dir must be absolute POSIX paths');
}
if (!/^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(walineUpstream)) {
  throw new Error('waline-upstream must be loopback host:port');
}

let config = fs.readFileSync(input, 'utf8');
const replacements = [
  ['/etc/letsencrypt/live/new.andy-y.cn/fullchain.pem', `${certDir}/fullchain.pem`, 1],
  ['/etc/letsencrypt/live/new.andy-y.cn/privkey.pem', `${certDir}/privkey.pem`, 1],
  ['root /var/www/andy-y.cn/candidate/site;', `root ${siteRoot};\n  access_log /www/sites/new.andy-y.cn/log/access.log main;\n  error_log /www/sites/new.andy-y.cn/log/error.log;`, 1],
  ['proxy_pass http://waline-staging:8360;', `proxy_pass http://${walineUpstream};`, 2],
];

for (const [from, to, expected] of replacements) {
  const count = config.split(from).length - 1;
  if (count !== expected) {
    throw new Error(`expected ${expected} occurrence(s) of ${from}, got ${count}`);
  }
  config = config.replaceAll(from, to);
}

if (!config.includes('server_name new.andy-y.cn;')) throw new Error('missing staging server');
if (!config.includes('X-Robots-Tag "noindex, nofollow, noarchive"')) throw new Error('missing noindex');
if (config.includes('waline-staging:8360') || config.includes('/etc/letsencrypt/live/new.andy-y.cn')) {
  throw new Error('unadapted staging references remain');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, config, 'utf8');
console.log(JSON.stringify({ input: path.relative(ROOT, input), output: path.relative(ROOT, output), siteRoot, certDir, walineUpstream }));
