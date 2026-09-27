#!/usr/bin/env node
/**
 * Dual-language Pagefind indexing (P4).
 *
 * zh index: en pages are stashed out of dist before indexing so zh search
 *           never returns English pages (they joined dist in P4).
 * en index: built from dist/en only, written to dist/en/pagefind.
 *
 * Replaces the inline `pagefind --site dist --force-language zh` step in
 * astro/package.json. Cross-platform (local Windows + Linux builder).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'astro', 'dist');
const EN_DIR = path.join(DIST, 'en');
const STASH = path.join(os.tmpdir(), `andy-en-stash-${process.pid}`);
const EN_TMP = path.join(os.tmpdir(), `andy-en-site-${process.pid}`);

function pagefind(args) {
  // npx resolves the local devDependency binary on both platforms.
  const result = spawnSync('npx', ['pagefind', ...args], {
    cwd: path.join(ROOT, 'astro'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`pagefind ${args.join(' ')} exited ${result.status}`);
  }
}

if (!fs.existsSync(DIST)) {
  console.error('astro/dist missing — run astro build first');
  process.exit(1);
}

const hasEn = fs.existsSync(EN_DIR);
let stashed = false;
try {
  if (hasEn) {
    fs.rmSync(STASH, { recursive: true, force: true });
    fs.renameSync(EN_DIR, STASH);
    stashed = true;
  }
  pagefind(['--site', 'dist', '--force-language', 'zh']);
} finally {
  if (stashed) {
    fs.rmSync(EN_DIR, { recursive: true, force: true });
    fs.renameSync(STASH, EN_DIR);
  }
}

if (hasEn) {
  fs.rmSync(EN_TMP, { recursive: true, force: true });
  fs.cpSync(EN_DIR, EN_TMP, { recursive: true });
  pagefind([
    '--site', EN_TMP,
    '--force-language', 'en',
    '--output-path', path.join(EN_DIR, 'pagefind'),
  ]);
  fs.rmSync(EN_TMP, { recursive: true, force: true });
}

console.log('pagefind: zh index at /pagefind, en index at /en/pagefind');
