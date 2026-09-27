#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDN_PURGE_SITE, createPreheatPlan } from './cdn-purge-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
};

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function objectPath(siteDir, pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded === '/') return path.join(siteDir, 'index.html');
  if (decoded.endsWith('/')) return path.join(siteDir, decoded.slice(1), 'index.html');
  return path.join(siteDir, decoded.slice(1));
}

export function collectPreheatUrls(siteDir) {
  const sitemap = path.join(siteDir, 'sitemap-0.xml');
  if (!fs.existsSync(sitemap) || !fs.statSync(sitemap).isFile()) throw new Error(`missing sitemap: ${sitemap}`);
  const xml = fs.readFileSync(sitemap, 'utf8');
  const discovered = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1].trim()));
  const fixedCandidates = ['/robots.txt', '/llms.txt', '/llms-full.txt', '/rss.xml', '/en/rss.xml', '/listening/', '/en/listening/', '/linuxdo/', '/sitemap-0.xml', '/sitemap-index.xml'].map((item) => new URL(item, CDN_PURGE_SITE).href);
  // fixed candidates may not exist in older/minimal site fixtures — keep only on-disk ones
  const fixed = fixedCandidates.filter((value) => fs.existsSync(objectPath(siteDir, new URL(value).pathname)));
  const urls = [...new Set([...discovered, ...fixed])].sort();
  // Aliyun daily preheat quota is small (tens); the full sitemap (80+ URLs)
  // exceeded it and blocked the whole CDN submission on 2026-09-27. Preheat is
  // best-effort warm-up: cap to a curated critical set, refresh still covers all.
  const PREHEAT_CAP = 30;
  const critical = new Set(fixed);
  for (const p of ['/', '/posts/', '/archive/', '/friends/', '/about/', '/dn42/', '/en/', '/en/posts/', '/en/archive/', '/en/friends/', '/en/about/', '/en/dn42/']) {
    const u = new URL(p, CDN_PURGE_SITE).href;
    if (fs.existsSync(objectPath(siteDir, u === undefined ? p : new URL(u).pathname))) critical.add(u);
  }
  const capped = urls.filter((u) => critical.has(u)).concat(urls.filter((u) => !critical.has(u))).slice(0, PREHEAT_CAP);
  const finalUrls = [...new Set(capped)].sort();
  for (const value of finalUrls) {
    const url = new URL(value);
    if (url.origin !== CDN_PURGE_SITE || url.search || url.hash) throw new Error(`unsafe sitemap URL: ${value}`);
    const file = objectPath(siteDir, url.pathname);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`preheat object is missing from site output: ${url.pathname}`);
  }
  return finalUrls;
}

function main() {
  const releaseId = valueFor('--release-id');
  const siteDir = path.resolve(ROOT, valueFor('--site-dir'));
  const out = path.resolve(ROOT, valueFor('--out'));
  const plan = createPreheatPlan({ releaseId, urls: collectPreheatUrls(siteDir) });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ out: path.relative(ROOT, out), releaseId, urls: plan.urls.length, sha256: plan.sha256 })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
