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

/** Walk release site/pagefind (and en/pagefind) into URL paths (index + fragments included). */
export function listPagefindPathsFromSite(siteDir) {
  const roots = [
    { dir: path.join(siteDir, 'pagefind'), urlBase: '/pagefind' },
    { dir: path.join(siteDir, 'en', 'pagefind'), urlBase: '/en/pagefind' },
  ];
  const paths = [];
  const walk = (dir, urlBase) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, name.name);
      const url = `${urlBase}/${name.name}`;
      if (name.isDirectory()) walk(next, url);
      else paths.push(url);
    }
  };
  for (const { dir, urlBase } of roots) {
    if (fs.existsSync(dir)) walk(dir, urlBase);
  }
  return paths.sort();
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

export function collectPagefindPaths({
  root = ROOT,
  wwwRoot = process.env.WWW_ROOT || '',
  siteDir = '',
} = {}) {
  const paths = new Set();
  const dirs = [];
  if (siteDir) dirs.push(siteDir);
  dirs.push(path.join(root, 'astro', 'dist'));
  if (wwwRoot) {
    dirs.push(path.join(wwwRoot, 'current', 'site'));
    dirs.push(path.join(wwwRoot, 'previous', 'site'));
  }
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const p of listPagefindPathsFromSite(dir)) paths.add(p);
  }
  return [...paths].sort();
}

/**
 * Walk a built site dir for en-page index.html URL paths so withdrawn
 * translations (gone from the current selection) still get purged.
 */
export function listEnPagePathsFromSite(siteDir) {
  const root = path.join(siteDir, 'en');
  if (!fs.existsSync(root)) return [];
  const paths = [];
  const walk = (dir, urlBase) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, name.name);
      if (name.isDirectory()) walk(next, `${urlBase}${name.name}/`);
      else if (name.name === 'index.html') paths.push(urlBase);
    }
  };
  walk(root, '/en/');
  return paths.sort();
}

/**
 * /en/ URLs: static routes plus every render-expected translated entry from
 * the i18n selection written by sync-typecho.js (astro/.cache), unioned
 * with /en/ pages present in the previous live site (withdrawal purges).
 * Missing selection file means a pre-i18n environment — statics + walk only.
 */
export function collectEnPaths({
  root = ROOT,
  wwwRoot = process.env.WWW_ROOT || '',
  previousSiteDir = '',
} = {}) {
  const paths = new Set(['/en/', '/en/posts/', '/en/archive/', '/en/friends/', '/en/about/']);
  const selectionPath = path.join(root, 'astro', '.cache', 'i18n-selection.json');
  if (fs.existsSync(selectionPath)) {
    const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
    for (const entry of selection.entries || []) {
      if (entry?.renderExpected && entry.canonicalPath) paths.add(entry.canonicalPath);
    }
  }
  const dirs = [];
  if (previousSiteDir) dirs.push(previousSiteDir);
  if (wwwRoot) {
    dirs.push(path.join(wwwRoot, 'current', 'site'));
    dirs.push(path.join(wwwRoot, 'previous', 'site'));
  }
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const p of listEnPagePathsFromSite(dir)) paths.add(p);
  }
  return [...paths].sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const releaseId = valueFor('--release-id');
  const out = path.resolve(ROOT, valueFor('--out'));
  const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/legacy-url-map.json'), 'utf8'));
  const extraPaths = [...new Set([...collectMomentPaths(), ...collectPagefindPaths(), ...collectEnPaths()])].sort();
  const plan = createPurgePlan({ releaseId, legacy, extraPaths });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ out: path.relative(ROOT, out), releaseId, urls: plan.urls.length, sha256: plan.sha256 })}\n`);
}
