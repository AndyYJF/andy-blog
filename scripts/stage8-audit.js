/**
 * Stage 8 content audit — one record per public CID.
 *
 * Scans synced markdown + built HTML for blockers/warnings, then writes:
 *   .cache/stage8-audit.json
 *   docs/baselines/reviews/cid-<N>.json  (created/updated)
 *   docs/baselines/reports/stage8-audit.md
 *
 * Blockers (must be 0 for gate):
 *   - residual Joe shortcodes in body
 *   - legacy Typecho internal links in body
 *   - /usr/uploads/ refs whose files are missing under astro/public
 *   - empty built article body
 *
 * Warnings (recorded, not blocking Stage 8 gate):
 *   - heading level skips / body h1
 *   - multi-category
 *   - unknown code-fence langs
 *   - local uploads present (verify 200 later)
 *   - sourceFormat html
 *   - shortcode density (converted hits)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO = path.join(ROOT, 'astro');
const REVIEWS = path.join(ROOT, 'docs/baselines/reviews');
const WRITE_REVIEWS = !process.argv.includes('--audit-only');
/** Sync automated audit fields + content hashes. Does NOT claim human review. */
const APPLY_PASS = process.argv.includes('--apply-pass') || process.argv.includes('--sync-audit');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const SHORTCODE_RE = /\{(?:message|alert|cloud|bilibili|collapse)\b/g;
const LEGACY_LINK_RE =
  /(?:https?:\/\/(?:www\.)?andy-y\.cn)?\/index\.php\/(?:archives|category|tag|page)\/[^\s)"']+|\]\(\s*\/archives\/\d+/gi;
const UPLOAD_RE = /\/usr\/uploads\/[^\s)"']+/g;
const FENCE_LANG_RE = /^```([^\s`]+)/gm;
const KNOWN_LANGS = new Set([
  '',
  'txt',
  'text',
  'md',
  'markdown',
  'html',
  'xml',
  'css',
  'scss',
  'js',
  'javascript',
  'ts',
  'typescript',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'nginx',
  'apache',
  'bash',
  'sh',
  'shell',
  'zsh',
  'powershell',
  'ps1',
  'python',
  'py',
  'go',
  'rust',
  'c',
  'cpp',
  'java',
  'sql',
  'dockerfile',
  'docker',
  'diff',
  'mermaid',
  'math',
  'latex',
  'plaintext',
  'console',
  'terminal',
  'http',
  'graphql',
  'vue',
  'svelte',
  'php',
  'ruby',
  'perl',
  'lua',
  'r',
  'swift',
  'kotlin',
  'csharp',
  'cs',
]);

function readJson(rel, fallback = null) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function stripFm(raw) {
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: raw };
  const yaml = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  /** @type {Record<string, unknown>} */
  const fm = {};
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^'.+'$/.test(v) || /^".+"$/.test(v)) v = v.slice(1, -1);
    fm[m[1]] = v;
  }
  // categories count via list items under categories:
  const catBlock = /(?:^|\n)categories:\n((?:  - .*\n)*)/.exec(raw);
  const cats = catBlock ? (catBlock[1].match(/^\s+- /gm) || []).length : 0;
  fm._categoryCount = cats;
  return { fm, body };
}

function headingStats(body) {
  const levels = [];
  const lines = body.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+\S/.exec(line);
    if (m) levels.push(m[1].length);
  }
  const skips = [];
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] > levels[i - 1] + 1) {
      skips.push(`${levels[i - 1]}→${levels[i]}`);
    }
  }
  const bodyH1 = levels.filter((l) => l === 1).length;
  return { levels, skips, bodyH1 };
}

function unknownFenceLangs(body) {
  const bad = new Set();
  for (const m of body.matchAll(FENCE_LANG_RE)) {
    const lang = (m[1] || '').trim().toLowerCase();
    if (!lang) continue;
    if (!KNOWN_LANGS.has(lang)) bad.add(lang);
  }
  return [...bad];
}

function resolveUpload(relUrl) {
  const clean = relUrl.split(/[?#]/)[0];
  const underPublic = path.join(ASTRO, 'public', clean.replace(/^\//, ''));
  const underBackup = path.join(ROOT, 'backups/typecho-uploads', clean.replace(/^\/usr\/uploads\//, ''));
  return {
    url: clean,
    publicExists: fs.existsSync(underPublic),
    backupExists: fs.existsSync(underBackup),
    publicPath: underPublic,
    backupPath: underBackup,
  };
}

function builtHtmlPath(canonicalPath) {
  const rel = canonicalPath.replace(/^\//, '');
  return path.join(ASTRO, 'dist', rel, 'index.html');
}

function articleBodyLen(html) {
  const m = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html || '');
  if (!m) return 0;
  const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length;
}

const manifest = readJson('astro/.cache/manifest.json');
const syncReport = readJson('astro/.cache/sync-report.json', {
  sourceFormatHtml: [],
  shortcodeHints: [],
  localUploadRefs: [],
  headingFixes: [],
});
if (!manifest?.entries?.length) {
  throw new Error('missing astro/.cache/manifest.json — run npm run sync first');
}

const shortcodeByCid = new Map((syncReport.shortcodeHints || []).map((h) => [h.cid, h.hits]));
const headingFixByCid = new Map((syncReport.headingFixes || []).map((h) => [h.cid, h.count]));

const records = [];
fs.mkdirSync(REVIEWS, { recursive: true });

for (const entry of [...manifest.entries].sort((a, b) => a.cid - b.cid)) {
  const kindDir = entry.kind === 'page' ? 'pages' : 'posts';
  const mdPath = path.join(ASTRO, 'src/content', kindDir, `${entry.entryId}.md`);
  if (!fs.existsSync(mdPath)) {
    records.push({
      cid: entry.cid,
      entryId: entry.entryId,
      kind: entry.kind,
      canonicalPath: entry.canonicalPath,
      status: 'block',
      blockers: [`missing markdown ${mdPath}`],
      warnings: [],
      notes: [],
    });
    continue;
  }

  const raw = fs.readFileSync(mdPath, 'utf8');
  const { fm, body } = stripFm(raw);
  const blockers = [];
  const warnings = [];
  const notes = [];

  const bodyTrim = body.replace(/\s+/g, '').trim();
  if (!bodyTrim && entry.canonicalPath === '/friends/') {
    notes.push('page body empty by design; friends render from data/friends.json (Joe JFriends)');
  } else if (!bodyTrim && entry.kind === 'page') {
    warnings.push('intentionally empty page body in Typecho source');
  } else if (!bodyTrim) {
    blockers.push('empty post body');
  }

  const shortcodes = [...body.matchAll(SHORTCODE_RE)].map((m) => m[0]);
  if (shortcodes.length) blockers.push(`residual shortcodes: ${[...new Set(shortcodes)].join(', ')}`);

  const legacy = [...body.matchAll(LEGACY_LINK_RE)].map((m) => m[0]);
  if (legacy.length) blockers.push(`legacy internal links (${legacy.length}): ${legacy.slice(0, 3).join(' | ')}`);

  const uploads = [...body.matchAll(UPLOAD_RE)].map((m) => m[0]);
  const uploadDetails = uploads.map(resolveUpload);
  for (const u of uploadDetails) {
    if (!u.publicExists) {
      blockers.push(`missing public upload: ${u.url}${u.backupExists ? ' (present in backups)' : ''}`);
    }
  }
  if (uploadDetails.length && uploadDetails.every((u) => u.publicExists)) {
    notes.push(`local uploads ok (${uploadDetails.length})`);
  }

  if (fm.sourceFormat === 'html') {
    warnings.push('sourceFormat=html — verify tables/lists carefully');
  }

  const cats = Number(fm._categoryCount) || 0;
  if (cats > 1) notes.push(`multi-category (${cats})`);

  const heads = headingStats(body);
  if (heads.skips.length) warnings.push(`heading level skips: ${[...new Set(heads.skips)].join(', ')}`);
  if (heads.bodyH1 > 0) warnings.push(`body contains ${heads.bodyH1} h1 heading(s) (page title is separate)`);

  const badLangs = unknownFenceLangs(body);
  if (badLangs.length) warnings.push(`unknown fence langs: ${badLangs.join(', ')}`);

  const convertedHits = shortcodeByCid.get(entry.cid) || [];
  if (convertedHits.length) notes.push(`converted shortcodes: ${convertedHits.length}`);
  const headingFixes = headingFixByCid.get(entry.cid) || 0;
  if (headingFixes) notes.push(`headingFixes during sync: ${headingFixes}`);

  const htmlPath = builtHtmlPath(entry.canonicalPath);
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const len = articleBodyLen(html);
    if (!bodyTrim && entry.kind === 'page') {
      notes.push(`built body chars≈${len} (empty source page)`);
    } else if (len < 40) {
      blockers.push(`built article body too short (${len} chars)`);
    } else {
      notes.push(`built body chars≈${len}`);
    }
    if (SHORTCODE_RE.test(html)) blockers.push('residual shortcode visible in built HTML');
  } else {
    warnings.push('dist HTML missing — run build before final gate');
  }

  let status = 'pass';
  if (blockers.length) status = 'block';
  else if (warnings.length) status = 'warn';

  const record = {
    cid: entry.cid,
    entryId: entry.entryId,
    kind: entry.kind,
    title: String(fm.title || entry.entryId),
    canonicalPath: entry.canonicalPath,
    sourceFormat: fm.sourceFormat || 'unknown',
    status,
    blockers,
    warnings,
    notes,
    reviewedAt: null,
    reviewer: null,
  };
  records.push(record);

  if (WRITE_REVIEWS) {
    const reviewPath = path.join(REVIEWS, `cid-${entry.cid}.json`);
    let existing = null;
    if (fs.existsSync(reviewPath)) {
      existing = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    }
    const sourceHash = sha256(raw);
    const distHash = fs.existsSync(htmlPath) ? sha256(fs.readFileSync(htmlPath)) : null;

    const next = {
      cid: entry.cid,
      entryId: entry.entryId,
      kind: entry.kind,
      title: record.title,
      canonicalPath: entry.canonicalPath,
      snapshotEpoch: manifest.snapshotEpoch,
      auditStatus: status,
      blockers,
      warnings,
      notes,
      contentHashes: {
        sourceSha256: sourceHash,
        distSha256: distHash,
        hashedAt: new Date().toISOString(),
      },
      // Human / kind fields — preserved across automated sync
      reviewKind: existing?.reviewKind ?? null,
      verdict: existing?.verdict ?? null,
      reviewedAt: existing?.reviewedAt ?? null,
      reviewer: existing?.reviewer ?? null,
      checklist: existing?.checklist ?? {
        sourceFormatOk: null,
        tablesListsOk: null,
        multiCategoryOk: null,
        shortcodesOk: null,
        legacyLinksOk: null,
        localUploadsOk: null,
        headingsNoted: null,
      },
      manualNotes: existing?.manualNotes ?? [],
    };

    if (APPLY_PASS && status !== 'block') {
      // Automated audit sync only — never claim a human pass.
      if (!next.reviewKind || next.reviewKind === 'audit') {
        next.reviewKind = 'audit';
        next.verdict = 'audit-clean';
        next.reviewedAt = new Date().toISOString();
        next.reviewer = 'stage8-audit-auto';
        next.checklist = {
          sourceFormatOk: true,
          tablesListsOk: null,
          multiCategoryOk: true,
          shortcodesOk: blockers.every((b) => !b.includes('shortcode')),
          legacyLinksOk: blockers.every((b) => !b.includes('legacy')),
          localUploadsOk: !blockers.some((b) => b.includes('upload')),
          headingsNoted: true,
        };
      }
      if (status === 'warn') {
        next.manualNotes = [
          ...new Set([
            ...(next.manualNotes || []),
            ...warnings.map((w) => `auto-noted: ${w}`),
          ]),
        ];
      }
      next.manualNotes = [
        ...new Set([
          ...(next.manualNotes || []),
          'automated audit only — human 10–20min review still required for Stage 8 Final',
        ]),
      ];
    }

    fs.writeFileSync(reviewPath, `${JSON.stringify(next, null, 2)}\n`);
  }
}

const summary = {
  snapshotEpoch: manifest.snapshotEpoch,
  total: records.length,
  pass: records.filter((r) => r.status === 'pass').length,
  warn: records.filter((r) => r.status === 'warn').length,
  block: records.filter((r) => r.status === 'block').length,
  blockers: records.flatMap((r) => r.blockers.map((b) => ({ cid: r.cid, issue: b }))),
};

fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, '.cache/stage8-audit.json'),
  `${JSON.stringify({ summary, records }, null, 2)}\n`,
);

const md = [
  '# Stage 8 content audit',
  '',
  `Snapshot: \`${summary.snapshotEpoch}\``,
  '',
  `| status | count |`,
  `|---|---:|`,
  `| pass | ${summary.pass} |`,
  `| warn | ${summary.warn} |`,
  `| block | ${summary.block} |`,
  `| total | ${summary.total} |`,
  '',
  '## Per CID',
  '',
  ...records.map((r) => {
    const head = `- **${r.cid}** \`${r.entryId}\` (${r.kind}) — **${r.status}**`;
    const bits = [];
    if (r.blockers.length) bits.push(`  - blockers: ${r.blockers.join('; ')}`);
    if (r.warnings.length) bits.push(`  - warnings: ${r.warnings.join('; ')}`);
    if (r.notes.length) bits.push(`  - notes: ${r.notes.join('; ')}`);
    return [head, ...bits].join('\n');
  }),
  '',
];
fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/baselines/reports/stage8-audit.md'), md.join('\n'));

console.log(JSON.stringify(summary, null, 2));
if (summary.block > 0) process.exitCode = 2;
