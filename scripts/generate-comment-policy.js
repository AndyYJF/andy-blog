/**
 * Generate comment-policy.json for Waline middleware (§6.3).
 *
 * --mode disabled|enabled   controls top-level writeEnabled
 * --out path
 *
 * Entry writable flags always come from snapshot allowComment
 * (staging uses --mode enabled but still respects allowComment).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1];
};

const mode = arg('--mode');
const out = arg('--out');
if (mode !== 'disabled' && mode !== 'enabled') {
  throw new Error('--mode must be disabled|enabled');
}
if (!out) throw new Error('--out required');

const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'route-map.json'), 'utf8'));
const manifestPath = path.join(ROOT, 'astro', '.cache', 'manifest.json');
/** @type {Map<string, boolean>} */
const allowByKey = new Map();
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const e of manifest.entries || []) {
    if (e.commentKey) allowByKey.set(e.commentKey, e.allowComment !== false);
  }
}

const entries = {};
for (const route of Object.values(routeMap)) {
  if (route.state !== 'active') continue;
  if (!route.commentKey) continue;
  const allow = allowByKey.has(route.commentKey)
    ? allowByKey.get(route.commentKey)
    : true;
  entries[route.commentKey] = {
    writable: Boolean(allow),
    kind: route.kind,
    routeId: route.routeId,
  };
}

const policy = {
  writeEnabled: mode === 'enabled',
  generatedAt: new Date().toISOString(),
  entries,
};

const abs = path.isAbsolute(out) ? out : path.join(ROOT, out);
fs.mkdirSync(path.dirname(abs), { recursive: true });
fs.writeFileSync(abs, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
console.error(`comment-policy ${mode} writeEnabled=${policy.writeEnabled} entries=${Object.keys(entries).length} -> ${abs}`);
