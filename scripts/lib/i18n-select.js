/**
 * i18n version selection (docs/i18n-p2-design-2026-09-26.md §2) and English
 * markdown generation. Pure functions over the snapshot; sync-typecho.js
 * wires them into staging dirs and the content swap.
 */
import { convertShortcodes } from './shortcodes.js';
import { normalizeHeadings } from './headings.js';
import { remapFenceLangs } from './fence-langs.js';
import { normalizeJoeTaskMarkers } from './joe-task-markers.js';
import {
  deriveDescription,
  normalizeIncidentalTrailingWhitespace,
} from './content-presentation.js';

const stripMarkdownMarker = (text) => String(text || '').replace(/^<!--markdown-->\s*/i, '');
const detectFormat = (text) => (/^<!--markdown-->/i.test(String(text || '')) ? 'markdown' : 'html');

const indexBy = (rows, keyFn) => {
  const map = new Map();
  for (const row of rows || []) map.set(keyFn(row), row);
  return map;
};

/**
 * Decide, per public zh post/page, which English version (if any) ships.
 * Returns one entry per public cid: current/outdated carry the version row;
 * missing/disabled are status-only (renderExpected=false).
 */
export function selectI18nEntries(snapshot, pubs, epoch) {
  const i18n = snapshot.i18n;
  if (!i18n) return [];
  const heads = indexBy(i18n.heads, (h) => `${h.cid}:${h.locale}`);
  const versions = indexBy(i18n.versions, (v) => Number(v.version_id));
  const sourceState = indexBy(i18n.sourceState, (s) => Number(s.cid));
  const ledger = indexBy(i18n.ledger, (l) => `${l.cid}:${l.locale}`);

  const entries = [];
  for (const item of pubs) {
    if (item.type !== 'post' && item.type !== 'page') continue;
    const cid = Number(item.cid);
    const locale = 'en';
    const base = {
      entryKey: `${item.type}:${cid}:${locale}`,
      kind: item.type,
      sourceCid: cid,
      locale,
      rejectReason: null,
    };
    const head = heads.get(`${cid}:${locale}`);
    if (head && head.publication_state === 'disabled') {
      entries.push({ ...base, translationStatus: 'disabled', renderExpected: false });
      continue;
    }
    const approved = head?.approved_version_id ? versions.get(Number(head.approved_version_id)) : null;
    if (!approved) {
      entries.push({ ...base, translationStatus: 'missing', renderExpected: false });
      continue;
    }
    const state = sourceState.get(cid);
    const currentSourceRevision = state ? Number(state.source_revision) : Number(approved.source_revision);
    const outdated = Number(approved.source_revision) < currentSourceRevision;
    const ledgerRow = ledger.get(`${cid}:${locale}`);
    entries.push({
      ...base,
      translationStatus: outdated ? 'outdated' : 'current',
      renderExpected: true,
      sourceRevision: Number(approved.source_revision),
      currentSourceRevision,
      translationVersionId: Number(approved.version_id),
      contentDigest: approved.content_digest,
      translationAvailableAt: ledgerRow?.translation_available_at != null
        ? Number(ledgerRow.translation_available_at)
        : (approved.proofread_at != null ? Number(approved.proofread_at) : null),
      version: approved,
    });
  }
  return entries.sort((a, b) => a.sourceCid - b.sourceCid);
}

/**
 * Render an approved English version into collection markdown. Runs the same
 * structural transforms as the zh pipeline (shortcodes, Joe task markers,
 * headings, fence langs) but never repairKnownContent — those patches are
 * cid-specific zh text fixes and would mangle translations.
 */
export function buildI18nMarkdown(entry, zhItem, route, rels, cover) {
  const version = entry.version;
  const sourceFormat = detectFormat(zhItem.text);
  let body = stripMarkdownMarker(version.body).replace(/\r\n/g, '\n');
  const joeTasks = normalizeJoeTaskMarkers(body, { sourceFormat });
  body = joeTasks.text;
  body = normalizeHeadings(body).text;
  body = convertShortcodes(body, entry.sourceCid).text;
  body = remapFenceLangs(body).text;
  if (sourceFormat === 'markdown') body = normalizeIncidentalTrailingWhitespace(body);

  const availableAt = entry.translationAvailableAt ?? Number(zhItem.created);
  const fm = {
    slug: route.routeId,
    kind: zhItem.type,
    locale: 'en',
    title: String(version.title || zhItem.title),
    legacyCid: Number(zhItem.cid),
    canonicalPath: `/en${route.canonicalPath}`,
    commentKey: route.commentKey,
    feedGuid: `${route.feedGuid}#en`,
    allowComment: zhItem.allowComment === true || zhItem.allowComment === 1 || zhItem.allowComment === '1',
    allowFeed: zhItem.allowFeed === true || zhItem.allowFeed === 1 || zhItem.allowFeed === '1',
    pubDate: new Date(availableAt * 1000).toISOString(),
    updatedDate: new Date(Number(version.proofread_at ?? availableAt) * 1000).toISOString(),
    categories: rels.categories,
    tags: rels.tags,
    sourceFormat,
    sourceCid: entry.sourceCid,
    sourceRevision: entry.sourceRevision,
    sourcePublishedAt: new Date(Number(zhItem.created) * 1000).toISOString(),
    translationVersionId: entry.translationVersionId,
    translationStatus: entry.translationStatus,
    translationAvailableAt: new Date(availableAt * 1000).toISOString(),
  };
  if (zhItem.type === 'post') {
    const summary = String(version.summary || '').trim();
    let description = summary.length >= 24 ? summary : deriveDescription(body);
    // enPosts schema caps description at 480 chars; clamp so one over-long
    // summary can never fail the whole astro build again.
    if (description.length > 470) description = `${description.slice(0, 470).trimEnd()}…`;
    fm.description = description;
  }
  if (cover) fm.cover = cover;
  return { frontmatter: fm, body };
}

/** Public selection entry (no version body) for i18n-selection.json. */
export function publicSelectionEntry(entry, route, sourceFile) {
  const canonicalPath = `/en${route.canonicalPath}`;
  return {
    entryKey: entry.entryKey,
    kind: entry.kind,
    sourceCid: entry.sourceCid,
    locale: entry.locale,
    translationStatus: entry.translationStatus,
    sourceRevision: entry.sourceRevision ?? null,
    translationVersionId: entry.translationVersionId ?? null,
    contentDigest: entry.contentDigest ?? null,
    sourceFile,
    canonicalPath,
    outputFile: `${canonicalPath.replace(/^\//, '')}index.html`,
    renderExpected: entry.renderExpected === true,
    discoverable: false, // P2: noindex, not in sitemap/RSS — flips in P4
    equivalent: true,
    allowFeed: true,
    allowComment: true,
    translationAvailableAt: entry.translationAvailableAt ?? null,
    rejectReason: entry.rejectReason ?? null,
  };
}
