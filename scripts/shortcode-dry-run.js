#!/usr/bin/env node
/** Dry-run shortcode conversion against fixture snapshot. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertShortcodes } from './lib/shortcodes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const epoch = process.env.SNAPSHOT_EPOCH || '1785565762';
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, `docs/baselines/fixtures/snapshot-${epoch}.json`), 'utf8'),
);

const pubs = fixture.contents.filter(
  (c) =>
    (c.type === 'post' || c.type === 'page')
    && c.status === 'publish'
    && Number(c.created) < Number(epoch)
    && !(c.password || ''),
);

const report = [];
for (const item of pubs) {
  const body = String(item.text || '').replace(/^<!--markdown-->\s*/i, '');
  try {
    const { hits } = convertShortcodes(body, item.cid);
    report.push({
      cid: item.cid,
      title: item.title,
      hitCount: hits.length,
      hits,
      ok: true,
    });
  } catch (e) {
    report.push({
      cid: item.cid,
      title: item.title,
      ok: false,
      error: String(e.message || e),
    });
  }
}

const outPath = path.join(ROOT, 'docs/baselines/reports/shortcode-dry-run.json');
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const failed = report.filter((r) => !r.ok);
const totalHits = report.reduce((n, r) => n + (r.hitCount || 0), 0);
console.log(JSON.stringify({
  articles: report.length,
  totalHits,
  failed: failed.length,
  byKind: report.flatMap((r) => r.hits || []).reduce((acc, h) => {
    acc[h.kind] = (acc[h.kind] || 0) + 1;
    return acc;
  }, {}),
  outPath,
}, null, 2));
if (failed.length) process.exit(1);
