#!/usr/bin/env node
/**
 * Astro copies public/ into dist/ before markdown/mermaid runs.
 * @beoe/rehype-mermaid writes SVG files into astro/public/beoe afterwards,
 * so they must be copied into dist or every diagram 404s.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'astro', 'public', 'beoe');
const dest = path.join(ROOT, 'astro', 'dist', 'beoe');

if (!fs.existsSync(src)) {
  console.error('astro/public/beoe missing after mermaid render');
  process.exit(65);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });

const files = fs.readdirSync(src).filter((name) => name.endsWith('.svg'));
if (files.length === 0) {
  console.error('astro/public/beoe has no svg files');
  process.exit(65);
}
process.stdout.write(`${JSON.stringify({ ok: true, copied: files.length })}\n`);
