#!/usr/bin/env node
/** Assert Content Collection entry ids match route-map routeIds. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/route-map.json'), 'utf8'));
const kindDir = {
  post: 'posts',
  page: 'pages',
  moment: 'moments',
};

const listMd = (dir) => {
  const abs = path.join(ROOT, 'astro/src/content', dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith('.md'));
};

const posts = listMd('posts');
const pages = listMd('pages');
const moments = listMd('moments');

const errors = [];
for (const [cid, entry] of Object.entries(routeMap)) {
  if (entry.state !== 'active') continue;
  const dir = kindDir[entry.kind];
  if (!dir) {
    errors.push(`unknown kind=${entry.kind} cid=${cid}`);
    continue;
  }
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
  const slugLine = m[1].match(/^slug:\s*(.+)\s*$/m);
  const slugValue = slugLine
    ? slugLine[1].replace(/^['"]|['"]$/g, '').trim()
    : '';
  if (slugValue !== String(entry.routeId)) {
    errors.push(`frontmatter slug mismatch cid=${cid}`);
  }
  if (!m[1].match(new RegExp(`^legacyCid:\\s*${cid}\\s*$`, 'm'))) {
    errors.push(`legacyCid mismatch cid=${cid}`);
  }
}

const byKind = {
  post: new Set(posts.map((f) => f.replace(/\.md$/, ''))),
  page: new Set(pages.map((f) => f.replace(/\.md$/, ''))),
  moment: new Set(moments.map((f) => f.replace(/\.md$/, ''))),
};
for (const [kind, ids] of Object.entries(byKind)) {
  for (const id of ids) {
    const hit = Object.values(routeMap).find(
      (e) => e.state === 'active' && e.kind === kind && e.routeId === id,
    );
    if (!hit) errors.push(`orphan ${kind} file ${id}.md`);
  }
}

const out = {
  ok: errors.length === 0,
  posts: posts.length,
  pages: pages.length,
  moments: moments.length,
  errors,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
