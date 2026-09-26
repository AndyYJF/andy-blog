#!/usr/bin/env node
/**
 * Prerender validation for English entries (docs/i18n-p2-design-2026-09-26.md §6).
 *
 * Runs after sync-typecho, before astro build. Every renderExpected entry is
 * rendered through the SHARED markdown pipeline (astro/src/lib/markdown-pipeline.mjs).
 * Failures are attributed per entry (phase=prerender, attribution=content):
 * the entry is marked render-rejected in i18n-selection.json and its markdown
 * file is quarantined so astro build never sees it. Exit code is 0 even with
 * rejections — isolation is the whole point. Structural problems (missing
 * selection file, unreadable pipeline) exit non-zero.
 *
 * Mermaid needs Playwright; build-release runs this in the same environment
 * as astro build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rendererFingerprint } from './lib/i18n-fingerprint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO = path.join(ROOT, 'astro');
const CACHE = path.join(ASTRO, '.cache');
const SELECTION_PATH = path.join(CACHE, 'i18n-selection.json');
const REPORT_PATH = path.join(CACHE, 'i18n-prerender-report.json');
const QUARANTINE = path.join(CACHE, 'quarantine');

const MIN_BODY_CHARS = 40;
const MIN_RENDERED_RATIO = 0.25;

const stripFrontmatter = (text) => {
  const end = text.indexOf('\n---\n', 3);
  return end === -1 ? text : text.slice(end + 5);
};

const selection = JSON.parse(fs.readFileSync(SELECTION_PATH, 'utf8'));
const fingerprint = rendererFingerprint(ASTRO);

// beoe fsPath is relative ('public/beoe') — run pipeline with astro as cwd.
process.chdir(ASTRO);
const { renderWithSharedPipeline } = await import(
  pathToFileURL(path.join(ASTRO, 'src', 'lib', 'markdown-pipeline.mjs')).href
);

fs.rmSync(QUARANTINE, { recursive: true, force: true });
fs.mkdirSync(QUARANTINE, { recursive: true });

const report = { rendererFingerprint: fingerprint, entries: [] };
let rejected = 0;

for (const entry of selection.entries || []) {
  if (!entry.renderExpected) continue;
  const sourceAbs = path.join(ASTRO, entry.sourceFile);
  const record = {
    entryKey: entry.entryKey,
    versionId: entry.translationVersionId,
    phase: 'prerender',
    attribution: 'content',
    ok: true,
    error: null,
  };
  try {
    const source = fs.readFileSync(sourceAbs, 'utf8');
    const body = stripFrontmatter(source);
    const html = await renderWithSharedPipeline(body);
    // Silent-drop detection mirrors render-gate: mermaid failure can discard
    // the whole document without throwing.
    const renderedText = html
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const bodyText = body.replace(/\s+/g, ' ').trim();
    if (bodyText.length >= MIN_BODY_CHARS && renderedText.length < bodyText.length * MIN_RENDERED_RATIO) {
      throw new Error(
        `silent-drop: body ${bodyText.length} chars rendered to ${renderedText.length} chars`,
      );
    }
  } catch (err) {
    record.ok = false;
    record.error = String(err instanceof Error ? err.message : err).slice(0, 500);
    entry.translationStatus = 'render-rejected';
    entry.renderExpected = false;
    entry.rejectReason = `prerender: ${record.error}`;
    rejected += 1;
    // Quarantine the markdown so astro build cannot emit a page for it.
    const dest = path.join(QUARANTINE, entry.sourceFile.replaceAll('/', '__'));
    fs.renameSync(sourceAbs, dest);
  }
  report.entries.push(record);
}

selection.rendererFingerprint = fingerprint;
const tmp = `${SELECTION_PATH}.${process.pid}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(selection, null, 2)}\n`);
fs.renameSync(tmp, SELECTION_PATH);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

for (const record of report.entries) {
  if (!record.ok) {
    console.error(`render-rejected ${record.entryKey} v${record.versionId}: ${record.error}`);
  }
}
console.log(
  `prerender-en: ${report.entries.length - rejected}/${report.entries.length} entries ok`
  + (rejected ? ` (${rejected} isolated as render-rejected)` : ''),
);
