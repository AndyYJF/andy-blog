#!/usr/bin/env node
/**
 * @beoe/rehype-code-hook-img documents a `cache` option but strips it and
 * never forwards it to rehypeCodeHook. Patch the installed dist so a Map
 * cache (and hashTostring) actually skips Playwright for unchanged fences.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const candidates = [
  path.join(root, 'astro', 'node_modules', '@beoe', 'rehype-code-hook-img', 'dist', 'index.js'),
  path.join(process.cwd(), 'node_modules', '@beoe', 'rehype-code-hook-img', 'dist', 'index.js'),
  path.join(process.cwd(), 'astro', 'node_modules', '@beoe', 'rehype-code-hook-img', 'dist', 'index.js'),
];

const indexJs = candidates.find((p) => fs.existsSync(p));
if (!indexJs) {
  console.error('[patch-beoe] @beoe/rehype-code-hook-img not installed');
  process.exit(1);
}

const src = fs.readFileSync(indexJs, 'utf8');

if (src.includes('hashTostring: true') && /\bcache,\s*\n\s*hashTostring/.test(src)) {
  console.log('[patch-beoe] cache forward already applied');
  process.exit(0);
}

const needle = `return rehypeCodeHook({
            salt: defaults,
            language,`;
const replacement = `return rehypeCodeHook({
            cache,
            hashTostring: true,
            salt: defaults,
            language,`;

if (!src.includes(needle)) {
  console.error(`[patch-beoe] unexpected source in ${indexJs}`);
  process.exit(1);
}

fs.writeFileSync(indexJs, src.replace(needle, replacement));
console.log(`[patch-beoe] forwarded cache + hashTostring in ${indexJs}`);
