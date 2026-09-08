#!/usr/bin/env node
/**
 * Before an offbox rebuild, preserve live ?p={cid} → /moments/{cid}/ nginx map
 * entries as route-map tombstones. Offbox rsync starts from the VPS control
 * tree; without this, deleted moments vanish from route-map and unattended
 * switch refuses map shrinkage (compare-nginx-policy exit 69).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE_MAP = path.join(ROOT, 'data', 'route-map.json');
const wwwRoot = process.env.WWW_ROOT || '';

function readLiveMomentRedirects(confPath) {
  if (!confPath || !fs.existsSync(confPath)) return [];
  const text = fs.readFileSync(confPath, 'utf8');
  const block = /map "\$uri:\$arg_p" \$legacy_query_target \{([\s\S]*?)^\}/m.exec(text);
  if (!block) return [];
  const out = [];
  for (const match of block[1].matchAll(/"\/(?:index\.php)?:(\d+)"\s+"(\/moments\/\d+\/)"/g)) {
    out.push({ cid: match[1], canonicalPath: match[2] });
  }
  // de-dupe by cid
  const byCid = new Map();
  for (const row of out) byCid.set(row.cid, row);
  return [...byCid.values()];
}

function main() {
  const conf = wwwRoot
    ? path.join(wwwRoot, 'current', 'nginx', 'release-http.conf')
    : '';
  const live = readLiveMomentRedirects(conf);
  const map = fs.existsSync(ROUTE_MAP)
    ? JSON.parse(fs.readFileSync(ROUTE_MAP, 'utf8'))
    : {};
  let added = 0;
  for (const { cid, canonicalPath } of live) {
    const existing = map[cid];
    if (existing?.state === 'active' && existing.kind === 'moment') continue;
    if (existing?.kind === 'moment' && existing.canonicalPath === canonicalPath) continue;
    if (existing && existing.kind && existing.kind !== 'moment') {
      throw new Error(`cid=${cid} exists as kind=${existing.kind}; refuse moment tombstone seed`);
    }
    if (!existing) {
      map[cid] = {
        kind: 'moment',
        routeId: cid,
        canonicalPath,
        commentKey: canonicalPath,
        feedGuid: `urn:andy-y:moment:${cid}`,
        legacyPaths: [],
        state: 'tombstone',
        disposition: 'gone',
        sourceSlug: cid,
      };
      added += 1;
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)),
  );
  fs.mkdirSync(path.dirname(ROUTE_MAP), { recursive: true });
  fs.writeFileSync(ROUTE_MAP, `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      liveMomentRedirects: live.length,
      seededTombstones: added,
      conf: conf || null,
    })}\n`,
  );
}

main();
