#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPurgePlan } from './cdn-purge-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
};

/** List /moments/page/N/ directories under a release site root. */
export function listMomentPagePathsFromSite(siteDir) {
  const paths = [];
  const pageRoot = path.join(siteDir, 'moments', 'page');
  if (!fs.existsSync(pageRoot)) return paths;
  for (const name of fs.readdirSync(pageRoot)) {
    if (!/^\d+$/.test(name)) continue;
    if (!fs.existsSync(path.join(pageRoot, name, 'index.html'))) continue;
    paths.push(`/moments/page/${name}/`);
  }
  return paths;
}

/**
 * Union current lastmod/route-map moment URLs with previous live list pages
 * so a shrinking feed still purges stale /moments/page/N/ CDN entries.
 */
export function collectMomentPaths({
  root = ROOT,
  wwwRoot = process.env.WWW_ROOT || '',
  previousSiteDir = '',
} = {}) {
  const paths = new Set(['/moments/', '/moments/rss.xml']);
  const lastmodPath = path.join(root, 'data/lastmod.json');
  if (fs.existsSync(lastmodPath)) {
    const lastmod = JSON.parse(fs.readFileSync(lastmodPath, 'utf8'));
    for (const key of Object.keys(lastmod)) {
      if (key.startsWith('/moments')) paths.add(key);
    }
  }
  const routeMapPath = path.join(root, 'data/route-map.json');
  if (fs.existsSync(routeMapPath)) {
    const routeMap = JSON.parse(fs.readFileSync(routeMapPath, 'utf8'));
    for (const entry of Object.values(routeMap)) {
      if (entry?.kind !== 'moment' || !entry.canonicalPath) continue;
      paths.add(entry.canonicalPath);
    }
  }

  const prevDirs = [];
  if (previousSiteDir) prevDirs.push(previousSiteDir);
  if (wwwRoot) {
    prevDirs.push(path.join(wwwRoot, 'current', 'site'));
    prevDirs.push(path.join(wwwRoot, 'previous', 'site'));
  }
  for (const dir of prevDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const p of listMomentPagePathsFromSite(dir)) paths.add(p);
  }
  return [...paths].sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const releaseId = valueFor('--release-id');
  const out = path.resolve(ROOT, valueFor('--out'));
  const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/legacy-url-map.json'), 'utf8'));
  const plan = createPurgePlan({ releaseId, legacy, extraPaths: collectMomentPaths() });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ out: path.relative(ROOT, out), releaseId, urls: plan.urls.length, sha256: plan.sha256 })}\n`);
}
