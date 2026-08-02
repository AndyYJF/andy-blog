/**
 * Emit candidate-nginx.conf / candidate-staging-nginx.conf for isolated
 * `nginx -t -c` against a release that must not include current/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const releaseId = arg('--release-id');
const outDir = arg('--out');
if (!releaseId || !outDir) throw new Error('--release-id and --out required');

const releaseRoot = `/var/www/andy-y.cn/releases/${releaseId}`;
const body = (includeStaging) => `events {
  worker_connections 1024;
}
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  # Isolated test entry: no conf.d directory and no current symlink.
  include ${releaseRoot}/nginx/release-http.conf;
${includeStaging ? `  include ${releaseRoot}/nginx/staging-http.conf;\n` : ''}}
`;

const abs = path.isAbsolute(outDir) ? outDir : path.join(ROOT, outDir);
fs.mkdirSync(abs, { recursive: true });
fs.writeFileSync(path.join(abs, 'candidate-nginx.conf'), body(false));
fs.writeFileSync(path.join(abs, 'candidate-staging-nginx.conf'), body(true));

// Minimal staging-http stub until Stage 9 wires new.andy-y.cn fully.
const staging = `# staging-http.conf — independent map variables (do not overwrite production).
map $uri $staging_legacy_target { default ""; }
map "$uri:$arg_p" $staging_legacy_query_target { default ""; }
map $uri $staging_not_found { default 0; }
map $uri $staging_gone { default 0; }
map "$uri:$arg_p" $staging_query_not_found { default 0; }
map "$uri:$arg_p" $staging_query_gone { default 0; }
`;
fs.writeFileSync(path.join(abs, 'staging-http.conf'), staging);
console.error(`candidate nginx configs -> ${abs}`);
