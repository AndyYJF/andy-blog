#!/usr/bin/env node
/** Assert Content Collection entry ids match route-map routeIds. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/route-map.json'), 'utf8'));
const posts = fs.readdirSync(path.join(ROOT, 'astro/src/content/posts')).filter((f) => f.endsWith('.md'));
const pages = fs.readdirSync(path.join(ROOT, 'astro/src/content/pages')).filter((f) => f.endsWith('.md'));

const errors = [];
for (const [cid, entry] of Object.entries(routeMap)) {
  if (entry.state !== 'active') continue;
  const dir = entry.kind === 'post' ? 'posts' : 'pages';
  const file = path.join(ROOT, 'astro/src/content', dir, `${entry.routeId}.md`);
  if (!fs.existsSync(file)) {
    errors.push(`missing file for cid=${cid} ${file}`);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) {
    errors.push(`no frontmatter cid=${cid}`);
    continue;
  }
  if (!m[1].includes(`slug: ${entry.routeId}`)) {
    errors.push(`frontmatter slug mismatch cid=${cid}`);
  }
  if (!m[1].includes(`legacyCid: ${cid}`)) {
    errors.push(`legacyCid mismatch cid=${cid}`);
  }
}

const postIds = new Set(posts.map((f) => f.replace(/\.md$/, '')));
const pageIds = new Set(pages.map((f) => f.replace(/\.md$/, '')));
for (const id of postIds) {
  const hit = Object.values(routeMap).find((e) => e.state === 'active' && e.kind === 'post' && e.routeId === id);
  if (!hit) errors.push(`orphan post file ${id}.md`);
}
for (const id of pageIds) {
  const hit = Object.values(routeMap).find((e) => e.state === 'active' && e.kind === 'page' && e.routeId === id);
  if (!hit) errors.push(`orphan page file ${id}.md`);
}

const out = { ok: errors.length === 0, posts: posts.length, pages: pages.length, errors };
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
