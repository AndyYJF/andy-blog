#!/usr/bin/env node
/**
 * Stage 1 sync: fixed SNAPSHOT_EPOCH → Content Collections markdown.
 * Sources: FIXTURE_PATH (JSON) or MySQL (DB_*). Never invent routeIds for known CIDs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import slugify from 'slugify';
import { convertShortcodes } from './lib/shortcodes.js';
import { normalizeHeadings } from './lib/headings.js';
import { remapFenceLangs } from './lib/fence-langs.js';
import { normalizeJoeTaskMarkers } from './lib/joe-task-markers.js';
import {
  deriveDescription,
  isDiscoverableMeta,
  normalizeIncidentalTrailingWhitespace,
  normalizeMetaName,
  repairKnownContent,
} from './lib/content-presentation.js';
import { ensureMetaRouteMap } from './lib/meta-route-allocate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASTRO = path.join(ROOT, 'astro');
const ROUTE_MAP_PATH = path.join(ROOT, 'data', 'route-map.json');
const META_ROUTE_MAP_PATH = path.join(ROOT, 'data', 'meta-route-map.json');
const CACHE_DIR = path.join(ASTRO, '.cache');
const FIELD_COVER = process.env.FIELD_COVER || 'thumb';
const ROUTE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireEpoch() {
  const raw = process.env.SNAPSHOT_EPOCH;
  if (!/^\d{10}$/.test(raw ?? '')) {
    throw new Error('SNAPSHOT_EPOCH is required (10-digit unix seconds)');
  }
  return Number(raw);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function toBool(v) {
  return v === true || v === 1 || v === '1';
}

function stripMarkdownMarker(text) {
  return String(text || '').replace(/^<!--markdown-->\s*/i, '');
}

function detectFormat(text) {
  return /^<!--markdown-->/i.test(String(text || '')) ? 'markdown' : 'html';
}

function isoFromUnix(sec) {
  return new Date(Number(sec) * 1000).toISOString();
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (fallback !== null && e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

async function atomicWriteText(file, body) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

async function loadSnapshot(epoch) {
  const fixture = process.env.FIXTURE_PATH
    || path.join(ROOT, 'docs', 'baselines', 'fixtures', `snapshot-${epoch}.json`);

  if (process.env.DB_HOST) {
    const mysql = await import('mysql2/promise');
    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
    });
    try {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
      const [[clock]] = await db.query('SELECT UNIX_TIMESTAMP() dbNow');
      if (!Number.isSafeInteger(epoch) || epoch > clock.dbNow) {
        throw new Error('invalid/future SNAPSHOT_EPOCH');
      }
      const [contents] = await db.query(
        `SELECT cid, type, title, slug, text, created, modified,
                allowComment, allowFeed, \`order\`, template, password, status
         FROM typecho_contents
         WHERE type IN ('post','page')
         ORDER BY cid`,
      );
      const [relations] = await db.query(
        `SELECT r.cid, m.mid, m.name, m.slug, m.type, m.\`order\`
         FROM typecho_relationships r
         JOIN typecho_metas m ON m.mid=r.mid
         ORDER BY r.cid, m.type, m.\`order\`, m.mid`,
      );
      const [fields] = await db.query(
        `SELECT cid, name, type, str_value, int_value, float_value
         FROM typecho_fields ORDER BY cid, name`,
      );
      const [metas] = await db.query(
        `SELECT mid, name, slug, type, description, count, \`order\`
         FROM typecho_metas WHERE type IN ('category','tag')
         ORDER BY type, \`order\`, mid`,
      );
      await db.commit();
      return { snapshotEpoch: epoch, contents, relations, fields, metas, source: 'mysql' };
    } catch (e) {
      try { await db.rollback(); } catch {}
      throw e;
    } finally {
      await db.end();
    }
  }

  const data = await readJson(fixture);
  if (Number(data.snapshotEpoch) !== epoch) {
    throw new Error(`fixture epoch ${data.snapshotEpoch} != SNAPSHOT_EPOCH ${epoch}`);
  }
  return { ...data, source: 'fixture' };
}

function publicContents(snapshot, epoch) {
  return snapshot.contents.filter(
    (c) =>
      (c.type === 'post' || c.type === 'page')
      && c.status === 'publish'
      && Number(c.created) < epoch
      && !(c.password || ''),
  );
}

function allocateRouteId(title, cid, used) {
  let base = slugify(String(title), { lower: true, strict: true, trim: true });
  if (!base || !ROUTE_ID_RE.test(base) || /^\d+$/.test(base)) {
    base = `item-${cid}`;
  }
  let id = base;
  if (used.has(id)) id = `${base}-${cid}`;
  if (!ROUTE_ID_RE.test(id)) throw new Error(`invalid routeId ${id} for cid=${cid}`);
  if (used.has(id)) throw new Error(`routeId collision unresolved for cid=${cid}`);
  used.add(id);
  return id;
}

function ensureRouteMap(routeMap, item, usedIds) {
  const key = String(item.cid);
  const existing = routeMap[key];
  if (existing) {
    if (existing.state === 'active') {
      if (!ROUTE_ID_RE.test(existing.routeId)) {
        throw new Error(`invalid stored routeId for cid=${key}`);
      }
      if (item.type === 'page' && !existing.canonicalPath) {
        throw new Error(`page cid=${key} missing canonicalPath in route-map`);
      }
      usedIds.add(existing.routeId);
      // refresh mutable sourceSlug only
      existing.sourceSlug = item.slug;
      return existing;
    }
    // tombstone stays
    return existing;
  }

  if (item.type === 'page') {
    throw new Error(`page cid=${key} has no route-map entry; refuse defaulting to post`);
  }

  const routeId = allocateRouteId(item.title, item.cid, usedIds);
  const entry = {
    kind: 'post',
    routeId,
    canonicalPath: `/posts/${routeId}/`,
    sourceSlug: item.slug,
    feedGuid: `urn:andy-y:post:${item.cid}`,
    commentKey: `/posts/${routeId}/`,
    legacyPaths: [
      `/index.php/archives/${item.cid}/`,
      `/archives/${item.cid}/`,
    ],
    state: 'active',
  };
  routeMap[key] = entry;
  return entry;
}

function relationsFor(cid, relations) {
  const cats = [];
  const tags = [];
  for (const r of relations.filter((x) => Number(x.cid) === Number(cid))) {
    const meta = {
      mid: Number(r.mid),
      name: normalizeMetaName(r.name, r.mid),
      slug: r.slug,
    };
    if (r.type === 'category') cats.push({ ...meta, order: Number(r.order) });
    if (r.type === 'tag') tags.push({ ...meta, order: Number(r.order) });
  }
  const sortMeta = (a, b) => a.order - b.order || a.mid - b.mid;
  cats.sort(sortMeta);
  tags.sort(sortMeta);
  return {
    categories: cats.map(({ mid, name, slug }) => ({ mid, name, slug })),
    tags: tags.map(({ mid, name, slug }) => ({ mid, name, slug })),
  };
}

function coverFor(cid, fields) {
  const hit = fields.find((f) => Number(f.cid) === Number(cid) && f.name === FIELD_COVER);
  const v = hit?.str_value?.trim();
  return v || undefined;
}

function buildMarkdown(item, route, rels, cover) {
  let body = stripMarkdownMarker(item.text).replace(/\r\n/g, '\n');
  const sourceFormat = detectFormat(item.text);
  const repaired = repairKnownContent(item, body);
  body = repaired.text;
  const joeTasks = normalizeJoeTaskMarkers(body, { sourceFormat });
  body = joeTasks.text;
  const headings = normalizeHeadings(body);
  body = headings.text;
  const converted = convertShortcodes(body, item.cid);
  body = converted.text;
  const fences = remapFenceLangs(body);
  body = fences.text;
  if (sourceFormat === 'markdown') body = normalizeIncidentalTrailingWhitespace(body);

  const fm = {
    slug: route.routeId,
    kind: item.type,
    title: item.title,
    legacyCid: Number(item.cid),
    canonicalPath: route.canonicalPath,
    commentKey: route.commentKey,
    feedGuid: route.feedGuid,
    allowComment: toBool(item.allowComment),
    allowFeed: toBool(item.allowFeed),
    pubDate: isoFromUnix(item.created),
    updatedDate: isoFromUnix(item.modified),
    categories: rels.categories,
    tags: rels.tags,
    sourceFormat,
  };
  if (item.type === 'post') fm.description = deriveDescription(body);
  if (cover) fm.cover = cover;

  const dumped = yaml.dump(fm, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  return {
    markdown: `---\n${dumped}---\n\n${body}\n`,
    shortcodeHits: converted.hits,
    headingFixes: headings.count,
    fenceRemaps: fences.remaps,
    contentRepairs: repaired.count,
    joeTaskMarkers: joeTasks.count,
  };
}

async function clearGenerated(dir) {
  await fs.mkdir(dir, { recursive: true });
  for (const name of await fs.readdir(dir)) {
    if (name.endsWith('.md')) await fs.unlink(path.join(dir, name));
  }
}

async function main() {
  const epoch = requireEpoch();
  const snapshot = await loadSnapshot(epoch);
  const pubs = publicContents(snapshot, epoch);

  const routeMap = await readJson(ROUTE_MAP_PATH, {});
  const usedIds = new Set(
    Object.values(routeMap).filter((e) => e.state === 'active').map((e) => e.routeId),
  );

  // Mark missing publics as needing entries; tombstone actives not in public set
  const publicCids = new Set(pubs.map((p) => String(p.cid)));
  for (const [cid, entry] of Object.entries(routeMap)) {
    if (entry.state === 'active' && !publicCids.has(cid)) {
      entry.state = 'tombstone';
      entry.disposition = entry.disposition || 'not_found';
    }
  }

  const staging = path.join(CACHE_DIR, `sync-staging-${process.pid}`);
  const postsDir = path.join(staging, 'posts');
  const pagesDir = path.join(staging, 'pages');
  await fs.mkdir(postsDir, { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });

  const entries = [];
  const reports = {
    sourceFormatHtml: [],
    shortcodeHints: [],
    localUploadRefs: [],
    headingFixes: [],
    fenceRemaps: [],
    contentRepairs: [],
    joeTaskMarkers: [],
  };

  for (const item of pubs.sort((a, b) => a.cid - b.cid)) {
    const route = ensureRouteMap(routeMap, item, usedIds);
    if (route.state !== 'active') continue;
    if (item.type === 'page' && (!route.canonicalPath || !route.canonicalPath.endsWith('/'))) {
      throw new Error(`page cid=${item.cid} canonicalPath must be explicit and trailing-slash`);
    }

    const rels = relationsFor(item.cid, snapshot.relations);
    const cover = coverFor(item.cid, snapshot.fields);
    const { markdown: md, shortcodeHits, headingFixes, fenceRemaps, contentRepairs, joeTaskMarkers } = buildMarkdown(item, route, rels, cover);
    const outName = `${route.routeId}.md`;
    const outDir = item.type === 'post' ? postsDir : pagesDir;
    await atomicWriteText(path.join(outDir, outName), md);

    if (detectFormat(item.text) === 'html') reports.sourceFormatHtml.push(item.cid);
    if (/\/usr\/uploads\//.test(item.text)) reports.localUploadRefs.push(item.cid);
    if (shortcodeHits.length) reports.shortcodeHints.push({ cid: item.cid, hits: shortcodeHits });
    if (headingFixes > 0) reports.headingFixes.push({ cid: item.cid, count: headingFixes });
    if (fenceRemaps.length) reports.fenceRemaps.push({ cid: item.cid, remaps: fenceRemaps });
    if (contentRepairs > 0) reports.contentRepairs.push({ cid: item.cid, count: contentRepairs });
    if (joeTaskMarkers > 0) reports.joeTaskMarkers.push({ cid: item.cid, count: joeTaskMarkers });

    entries.push({
      cid: Number(item.cid),
      kind: item.type,
      entryId: route.routeId,
      canonicalPath: route.canonicalPath,
      commentKey: route.commentKey,
      feedGuid: route.feedGuid,
      legacyPaths: route.legacyPaths,
      updatedDate: isoFromUnix(item.modified),
      allowComment: toBool(item.allowComment),
      categoryMids: rels.categories.map((c) => c.mid).sort((a, b) => a - b),
      tagMids: rels.tags.map((t) => t.mid).sort((a, b) => a - b),
      contentSha256: sha256(md),
    });
  }

  await atomicWriteJson(ROUTE_MAP_PATH, routeMap);

  // Refresh names/sourceSlug, and allocate routes for metas that are new in the snapshot.
  const metaMap = await readJson(META_ROUTE_MAP_PATH, {});
  ensureMetaRouteMap(metaMap, snapshot.metas || []);

  for (const [midStr, meta] of Object.entries(metaMap)) {
    if (meta.state !== 'active') continue;
    const mid = Number(midStr);
    const count = entries.filter((entry) => {
      if (entry.kind !== 'post') return false;
      const bag = meta.type === 'category' ? entry.categoryMids : entry.tagMids;
      return bag.includes(mid);
    }).length;
    meta.count = count;
    meta.discoverable = isDiscoverableMeta(meta, count, mid);
  }
  await atomicWriteJson(META_ROUTE_MAP_PATH, metaMap);

  const sitemapLastmod = {};
  for (const e of entries) {
    sitemapLastmod[e.canonicalPath] = e.updatedDate;
  }
  // list pages — each list canonical uses max(updatedDate) of its members
  const PAGE_SIZE = 10;
  const postEntries = entries
    .filter((e) => e.kind === 'post')
    .sort((a, b) => b.updatedDate.localeCompare(a.updatedDate) || b.cid - a.cid);
  const latestPost = postEntries[0];
  if (latestPost) {
    sitemapLastmod['/'] = latestPost.updatedDate;
    sitemapLastmod['/archive/'] = latestPost.updatedDate;
  }

  // Article index pagination lastmod (pub-date order mirrors astro/src/lib/posts.ts).
  // Page one lives at /posts/; /page/<n>/ remains the compatibility route for n >= 2.
  const pubByCid = new Map(pubs.map((p) => [Number(p.cid), Number(p.created)]));
  const postsSorted = [...entries]
    .filter((e) => e.kind === 'post')
    .sort((a, b) => {
      const ap = pubByCid.get(a.cid) ?? 0;
      const bp = pubByCid.get(b.cid) ?? 0;
      return bp - ap || b.cid - a.cid;
    });
  const totalPages = Math.max(1, Math.ceil(postsSorted.length / PAGE_SIZE));
  for (let n = 1; n <= totalPages; n += 1) {
    const slice = postsSorted.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE);
    const maxUpdated = slice
      .map((e) => e.updatedDate)
      .sort()
      .at(-1);
    if (!maxUpdated) continue;
    if (n === 1) sitemapLastmod['/posts/'] = maxUpdated;
    else sitemapLastmod[`/page/${n}/`] = maxUpdated;
  }

  // Category / tag list pages
  for (const [midStr, meta] of Object.entries(metaMap)) {
    if (meta.state !== 'active') continue;
    const mid = Number(midStr);
    const members = entries.filter((e) => {
      if (e.kind !== 'post') return false;
      const bag = meta.type === 'category' ? e.categoryMids : e.tagMids;
      return bag.includes(mid);
    });
    const maxUpdated = members
      .map((e) => e.updatedDate)
      .sort()
      .at(-1);
    if (meta.discoverable && maxUpdated) sitemapLastmod[meta.canonicalPath] = maxUpdated;
  }

  const sitemapExclude = Object.values(metaMap)
    .filter((meta) => meta.state === 'active' && meta.discoverable === false)
    .map((meta) => meta.canonicalPath)
    .sort();

  const manifest = {
    snapshotEpoch: epoch,
    source: snapshot.source,
    entries: entries.sort((a, b) => a.cid - b.cid),
    sitemapLastmod,
    sitemapExclude,
  };

  // Deterministic normalized digest (exclude run metadata)
  const normalized = {
    snapshotEpoch: epoch,
    entries: manifest.entries,
    sitemapLastmod: Object.fromEntries(Object.entries(sitemapLastmod).sort()),
    routeMapActive: Object.fromEntries(
      Object.entries(routeMap)
        .filter(([, v]) => v.state === 'active')
        .sort(([a], [b]) => Number(a) - Number(b)),
    ),
    metaRouteMapActive: Object.fromEntries(
      Object.entries(metaMap)
        .filter(([, value]) => value.state === 'active')
        .sort(([a], [b]) => Number(a) - Number(b)),
    ),
  };
  const digest = sha256(JSON.stringify(normalized));

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await atomicWriteJson(path.join(CACHE_DIR, 'manifest.json'), manifest);
  await atomicWriteJson(path.join(CACHE_DIR, 'sync-digest.json'), { digest, snapshotEpoch: epoch });
  await atomicWriteJson(path.join(CACHE_DIR, 'sync-report.json'), reports);
  await atomicWriteJson(path.join(ROOT, 'data', 'lastmod.json'), Object.fromEntries(Object.entries(sitemapLastmod).sort()));

  // Replace content dirs atomically via staging swap
  const finalPosts = path.join(ASTRO, 'src', 'content', 'posts');
  const finalPages = path.join(ASTRO, 'src', 'content', 'pages');
  await fs.mkdir(path.join(ASTRO, 'src', 'content'), { recursive: true });
  await clearGenerated(finalPosts);
  await clearGenerated(finalPages);
  for (const name of await fs.readdir(postsDir)) {
    await fs.rename(path.join(postsDir, name), path.join(finalPosts, name));
  }
  for (const name of await fs.readdir(pagesDir)) {
    await fs.rename(path.join(pagesDir, name), path.join(finalPages, name));
  }
  await fs.rm(staging, { recursive: true, force: true });

  // Gate summary to stdout (stable)
  const sqlCids = pubs.map((p) => Number(p.cid)).sort((a, b) => a - b);
  const outCids = entries.map((e) => e.cid).sort((a, b) => a - b);
  const activeCids = Object.entries(routeMap)
    .filter(([, v]) => v.state === 'active')
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);

  console.log(JSON.stringify({
    snapshotEpoch: epoch,
    source: snapshot.source,
    digest,
    counts: {
      public: sqlCids.length,
      output: outCids.length,
      activeRoutes: activeCids.length,
    },
    sqlCids,
    outCids,
    activeCids,
    cidSetsEqual:
      JSON.stringify(sqlCids) === JSON.stringify(outCids)
      && JSON.stringify(outCids) === JSON.stringify(activeCids),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
