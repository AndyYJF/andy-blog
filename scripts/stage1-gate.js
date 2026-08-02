#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EPOCH = process.env.SNAPSHOT_EPOCH || '1785565762';

function runSync() {
  const r = spawnSync(process.execPath, ['scripts/sync-typecho.js'], {
    cwd: ROOT,
    env: { ...process.env, SNAPSHOT_EPOCH: EPOCH },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`sync failed: ${r.status}`);
  }
  return JSON.parse(r.stdout);
}

function hashTree(dir) {
  const files = [];
  function walk(d) {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.md')) {
        files.push({
          rel: path.relative(dir, p).replaceAll('\\', '/'),
          sha: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
        });
      }
    }
  }
  walk(dir);
  return crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

const a = runSync();
const digestA = a.digest;
const contentHashA = hashTree(path.join(ROOT, 'astro/src/content'));
const manifestA = fs.readFileSync(path.join(ROOT, 'astro/.cache/manifest.json'));

const b = runSync();
const digestB = b.digest;
const contentHashB = hashTree(path.join(ROOT, 'astro/src/content'));
const manifestB = fs.readFileSync(path.join(ROOT, 'astro/.cache/manifest.json'));

const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/route-map.json'), 'utf8'));
const midReport = [];
for (const e of b.outCids.map((cid) => {
  const entry = JSON.parse(fs.readFileSync(path.join(ROOT, 'astro/.cache/manifest.json'), 'utf8'))
    .entries.find((x) => x.cid === cid);
  return entry;
})) {
  midReport.push({ cid: e.cid, categoryMids: e.categoryMids, tagMids: e.tagMids });
}

const result = {
  cidSetsEqual: a.cidSetsEqual && b.cidSetsEqual,
  digestsEqual: digestA === digestB,
  contentTreesEqual: contentHashA === contentHashB,
  manifestsEqual: crypto.createHash('sha256').update(manifestA).digest('hex')
    === crypto.createHash('sha256').update(manifestB).digest('hex'),
  routeIdsImmutableSample: Object.entries(routeMap)
    .filter(([, v]) => v.state === 'active')
    .map(([cid, v]) => ({ cid: Number(cid), routeId: v.routeId, canonicalPath: v.canonicalPath })),
  midReport,
  digest: digestA,
};

console.log(JSON.stringify(result, null, 2));
if (!(result.cidSetsEqual && result.digestsEqual && result.contentTreesEqual && result.manifestsEqual)) {
  process.exit(1);
}
