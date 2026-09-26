#!/usr/bin/env node
/**
 * Bounded-fallback attributor (docs/i18n-p2-design-2026-09-26.md §6).
 *
 * Usage: node scripts/i18n-attribute-build-error.js <astro-build.log>
 *
 * Called when astro build fails AFTER prerender passed. If the log pins the
 * failure to exactly one English content file (an en entry's sourceFile path
 * appears in an error context), that entry is marked render-rejected and
 * quarantined, and the script exits 0 — build-release then retries the full
 * build exactly once. Any other failure shape exits 3: not attributable, the
 * whole candidate must fail. Never swallows zh/template/infra errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO = path.join(ROOT, 'astro');
const CACHE = path.join(ASTRO, '.cache');
const SELECTION_PATH = path.join(CACHE, 'i18n-selection.json');
const QUARANTINE = path.join(CACHE, 'quarantine');

const logPath = process.argv[2];
if (!logPath || !fs.existsSync(logPath)) {
  console.error('usage: i18n-attribute-build-error.js <astro-build.log>');
  process.exit(64);
}
const log = fs.readFileSync(logPath, 'utf8');
const selection = JSON.parse(fs.readFileSync(SELECTION_PATH, 'utf8'));

// Candidate entries still expected to render after prerender.
const candidates = (selection.entries || []).filter((e) => e.renderExpected);
// Attribution requires the entry's exact sourceFile path in the log.
const hits = candidates.filter((e) => e.sourceFile && log.includes(e.sourceFile));
// Also accept absolute-path variants (astro prints absolute paths on some errors).
const absHits = candidates.filter(
  (e) => e.sourceFile && log.includes(path.join(ASTRO, e.sourceFile)),
);
const attributed = [...new Set([...hits, ...absHits])];

if (attributed.length !== 1) {
  console.error(
    `build error not attributable to a single en entry (matched ${attributed.length}); failing the candidate`,
  );
  process.exit(3);
}

const entry = attributed[0];
const sourceAbs = path.join(ASTRO, entry.sourceFile);
entry.translationStatus = 'render-rejected';
entry.renderExpected = false;
entry.rejectReason = 'build: astro build failed with this entry (file-path attribution)';
fs.mkdirSync(QUARANTINE, { recursive: true });
if (fs.existsSync(sourceAbs)) {
  fs.renameSync(sourceAbs, path.join(QUARANTINE, entry.sourceFile.replaceAll('/', '__')));
}
const tmp = `${SELECTION_PATH}.${process.pid}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(selection, null, 2)}\n`);
fs.renameSync(tmp, SELECTION_PATH);
console.error(`isolated ${entry.entryKey} v${entry.translationVersionId} after build failure; one retry allowed`);
process.exit(0);
