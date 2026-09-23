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
  const fixed = ['/robots.txt', '/llms.txt', '/llms-full.txt', '/rss.xml', '/sitemap-0.xml', '/sitemap-index.xml'].map((item) => new URL(item, CDN_PURGE_SITE).href);
  const urls = [...new Set([...discovered, ...fixed])].sort();
  for (const value of urls) {
    const url = new URL(value);
    if (url.origin !== CDN_PURGE_SITE || url.search || url.hash) throw new Error(`unsafe sitemap URL: ${value}`);
    const file = objectPath(siteDir, url.pathname);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`preheat object is missing from site output: ${url.pathname}`);
  }
  return urls;
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
