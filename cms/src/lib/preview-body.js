import { convertShortcodes } from '../../../scripts/lib/shortcodes.js';
import { normalizeHeadings } from '../../../scripts/lib/headings.js';
import { remapFenceLangs } from '../../../scripts/lib/fence-langs.js';
import { normalizeJoeTaskMarkers } from '../../../scripts/lib/joe-task-markers.js';
import {
  normalizeIncidentalTrailingWhitespace,
  repairKnownContent,
} from '../../../scripts/lib/content-presentation.js';
import { PREVIEW_LIMITS } from './preview-channel.js';

export { PREVIEW_LIMITS, acceptPreviewMessage, assertPreviewFetchUrl, createPreviewGate } from './preview-channel.js';

function stripMarkdownMarker(text) {
  return String(text || '').replace(/^<!--markdown-->\s*/i, '');
}

function detectFormat(text) {
  return /^<!--markdown-->/i.test(String(text || '')) ? 'markdown' : 'html';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render copy only. The stored text is not rewritten.
 * Order matches buildMarkdown in scripts/sync-typecho.js.
 * Mermaid fences stay as source for a local browser bundle; this path does
 * not load the file-strategy plugin or Playwright, and it does not write beoe cache.
 */
export function previewBody(text, cid = 0) {
  const bytes = Buffer.byteLength(String(text), 'utf8');
  if (bytes > PREVIEW_LIMITS.maxBytes) {
    return { ok: false, error: 'preview body is too large', bytes };
  }
  let body = stripMarkdownMarker(text).replace(/\r\n/g, '\n');
  const sourceFormat = detectFormat(text);
  body = repairKnownContent({ cid }, body).text;
  body = normalizeJoeTaskMarkers(body, { sourceFormat }).text;
  body = normalizeHeadings(body).text;
  body = convertShortcodes(body, cid, { strict: false }).text;
  body = remapFenceLangs(body).text;
  if (sourceFormat === 'markdown') body = normalizeIncidentalTrailingWhitespace(body);

  const mermaid = [];
  const htmlParts = [];
  const fence = /```mermaid\r?\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of body.matchAll(fence)) {
    htmlParts.push(`<pre class="cms-preview-source">${escapeHtml(body.slice(cursor, match.index))}</pre>`);
    mermaid.push(match[1].replace(/\s+$/u, ''));
    htmlParts.push(`<div class="mermaid-pending" data-cms-mermaid="${mermaid.length - 1}">图表暂时无法按线上 SVG 显示</div>`);
    cursor = match.index + match[0].length;
  }
  htmlParts.push(`<pre class="cms-preview-source">${escapeHtml(body.slice(cursor))}</pre>`);
  const withoutMermaid = body.replace(fence, () => '\n\n');
  const html = `<article class="prose reading-prose">${htmlParts.join('')}</article>`;
  return {
    ok: true,
    bytes,
    sourceFormat,
    markdown: withoutMermaid,
    mermaid,
    html,
    temporaryDifferences: [
      'interactive preview does not run file Mermaid or Expressive Code',
      'code fences stay escaped text; visitor pages use github-light/github-dark via data-theme',
    ],
  };
}
