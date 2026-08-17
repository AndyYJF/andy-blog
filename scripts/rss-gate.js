/**
 * RSS guid stability gate (§5.4).
 *
 * Cutover locked the 10 GUIDs from the 2026-08-01 Typecho feed, in order.
 * After cutover, new posts may appear at the front of the 10-item window.
 * The fixture sequence must remain a contiguous prefix of whatever is left
 * after that new prefix (older fixture items may fall off the window).
 * Each item must contain exactly one <guid>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'docs', 'baselines', 'rss', 'live-feed-20260801.xml');
const BUILT = path.join(ROOT, 'astro', 'dist', 'rss.xml');

const guidsInOrder = (xml) => {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((item, index) => {
    const guids = [...item.matchAll(/<guid\b[^>]*>([^<]*)<\/guid>/g)].map((m) => m[1]);
    if (guids.length !== 1) {
      throw new Error(`item #${index + 1} has ${guids.length} <guid> elements`);
    }
    return guids[0];
  });
};

const fixture = fs.readFileSync(FIXTURE, 'utf8');
const built = fs.readFileSync(BUILT, 'utf8');
const expected = guidsInOrder(fixture);
const actual = guidsInOrder(built);

if (expected.length !== 10) {
  throw new Error(`fixture GUID count ${expected.length}, expected 10`);
}
if (actual.length !== expected.length) {
  throw new Error(`built RSS has ${actual.length} items, fixture has ${expected.length}`);
}

const newPrefix = (() => {
  for (let offset = 0; offset < actual.length; offset += 1) {
    const kept = actual.length - offset;
    if (expected.slice(0, kept).every((guid, i) => guid === actual[offset + i])) {
      return offset;
    }
  }
  return -1;
})();

if (newPrefix === -1) {
  const mismatches = [];
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== actual[i]) {
      mismatches.push({ index: i, expected: expected[i], actual: actual[i] });
    }
  }
  console.error(JSON.stringify({ mismatches }, null, 2));
  process.exit(1);
}

// Auto-generated link-as-guid must not appear alongside our customData guid.
const autoGuidHits = [...built.matchAll(/<guid>(https:\/\/www\.andy-y\.cn\/posts\/[^<]+)<\/guid>/g)];
if (autoGuidHits.length) {
  console.error('auto link-derived <guid> still present:', autoGuidHits.map((m) => m[1]));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      count: actual.length,
      newItems: newPrefix,
      guids: actual,
    },
    null,
    2,
  ),
);
