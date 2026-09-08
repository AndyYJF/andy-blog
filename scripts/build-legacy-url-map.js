/**
 * Build data/legacy-url-map.json from Stage-0 evidence + route maps.
 *
 * Sources (recorded on every entry):
 *   - route-map / meta-route-map (database + sync)
 *   - live-crawl (docs/baselines/urls/)
 *   - rss (docs/baselines/rss/)
 *   - routing-table (sql-gates rewrite=0 permalinks)
 *
 * Category / tag / archive targets are the planned Stage-6 canonicals.
 * Until those pages exist, local Astro preview will 404 them; Nginx still
 * must emit the redirects so production switches are not blocked later.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.andy-y.cn';
const NOW = '2026-08-02T00:00:00Z';
const FIRST = '2026-08-01T00:00:00Z';

const readJson = async (rel) =>
  JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));

/** @type {Map<string, object>} */
const entries = new Map();

const upsert = (partial) => {
  const key = partial.queryKey
    ? `q:${partial.queryKey}`
    : `p:${partial.oldPath}`;
  const existing = entries.get(key);
  if (existing) {
    if (existing.action !== partial.action) {
      throw new Error(`action conflict on ${key}: ${existing.action} vs ${partial.action}`);
    }
    if ((existing.targetPath || null) !== (partial.targetPath || null)) {
      throw new Error(
        `target conflict on ${key}: ${existing.targetPath} vs ${partial.targetPath}`,
      );
    }
    existing.source = [...new Set([...(existing.source || []), ...(partial.source || [])])].sort();
    existing.lastVerifiedAt = NOW;
    if (partial.cid != null) existing.cid = partial.cid;
    if (partial.kind) existing.kind = partial.kind;
    return;
  }
  if (/[\r\n]/.test(partial.oldPath || '') || /[\r\n]/.test(partial.queryKey || '')) {
    throw new Error(`CR/LF in path: ${key}`);
  }
  entries.set(key, {
    oldPath: partial.oldPath ?? null,
    queryKey: partial.queryKey ?? null,
    action: partial.action,
    targetPath: partial.targetPath ?? null,
    expectedTerminalStatus: partial.expectedTerminalStatus,
    kind: partial.kind,
    cid: partial.cid ?? null,
    source: [...(partial.source || [])].sort(),
    firstSeenAt: FIRST,
    lastVerifiedAt: NOW,
  });
};

const redirect = (oldPath, targetPath, kind, source, cid = null) => {
  // Canonical URLs must be served as 200, never 302-to-self.
  if (oldPath === targetPath) return;
  upsert({
    oldPath,
    action: 'redirect',
    targetPath,
    expectedTerminalStatus: 200,
    kind,
    cid,
    source,
  });
};

const queryRedirect = (queryKey, targetPath, kind, source, cid = null) => {
  upsert({
    oldPath: null,
    queryKey,
    action: 'redirect',
    targetPath,
    expectedTerminalStatus: 200,
    kind,
    cid,
    source,
  });
};

const withSlashVariants = (p) => {
  const out = new Set([p]);
  if (p.endsWith('/')) out.add(p.slice(0, -1) || '/');
  else out.add(`${p}/`);
  return [...out];
};

async function main() {
  const routeMap = await readJson('data/route-map.json');
  const metaMap = await readJson('data/meta-route-map.json');

  // Content legacy paths from the immutable route table.
  for (const [cid, route] of Object.entries(routeMap)) {
    if (route.state === 'active') {
      for (const legacy of route.legacyPaths || []) {
        for (const variant of withSlashVariants(legacy)) {
          // Keep .html paths exact; only slash-normalize directory-style URLs.
          if (legacy.endsWith('.html') && variant !== legacy) continue;
          redirect(variant, route.canonicalPath, route.kind, ['route-map', 'live-crawl', 'database'], Number(cid));
        }
      }
      // Query-style ?p={cid} on documented Typecho entrypoints only.
      queryRedirect(`/:${cid}`, route.canonicalPath, route.kind, ['routing-table', 'database'], Number(cid));
      queryRedirect(`/index.php:${cid}`, route.canonicalPath, route.kind, ['routing-table', 'database'], Number(cid));
      continue;
    }

    // Tombstoned moments must keep ?p=cid redirects so unattended switch never
    // shrinks $legacy_query_target (compare-nginx-policy refuses removals).
    if (route.kind === 'moment' && route.canonicalPath) {
      queryRedirect(
        `/:${cid}`,
        route.canonicalPath,
        route.kind,
        ['routing-table', 'database', 'tombstone'],
        Number(cid),
      );
      queryRedirect(
        `/index.php:${cid}`,
        route.canonicalPath,
        route.kind,
        ['routing-table', 'database', 'tombstone'],
        Number(cid),
      );
    }
  }

  // Category / tag (Stage 6 pages; redirects still recorded now).
  for (const [mid, meta] of Object.entries(metaMap)) {
    if (meta.state !== 'active') continue;
    for (const legacy of meta.legacyPaths || []) {
      const variants = legacy.includes('%') ? [legacy] : withSlashVariants(legacy);
      for (const variant of variants) {
        redirect(variant, meta.canonicalPath, meta.type, ['meta-route-map', 'database'], Number(mid));
      }
    }
  }

  // Feed variants from homepage crawl + RSS fixture.
  for (const feed of [
    '/index.php/feed/',
    '/index.php/feed',
    '/index.php/feed/rss/',
    '/index.php/feed/rss',
    '/index.php/feed/atom/',
    '/index.php/feed/atom',
    '/feed/',
    '/feed',
  ]) {
    redirect(feed, '/rss.xml', 'feed', ['live-crawl', 'rss']);
  }

  // Archive index from Typecho routingTable (`/blog/`).
  for (const archive of withSlashVariants('/blog')) {
    redirect(archive, '/', 'archive', ['routing-table']);
  }
  for (const archive of withSlashVariants('/index.php/blog')) {
    redirect(archive, '/', 'archive', ['routing-table']);
  }

  // Typecho front controller itself — send bare /index.php to home.
  redirect('/index.php', '/', 'home', ['routing-table', 'live-crawl']);
  redirect('/index.php/', '/', 'home', ['routing-table', 'live-crawl']);

  // Sort for stable dumps: path redirects first, then query keys.
  const list = [...entries.values()].sort((a, b) => {
    const ak = a.queryKey ? `1:${a.queryKey}` : `0:${a.oldPath}`;
    const bk = b.queryKey ? `1:${b.queryKey}` : `0:${b.oldPath}`;
    return ak.localeCompare(bk);
  });

  const activeTargets = new Set(
    Object.values(routeMap)
      .filter((r) => r.state === 'active')
      .map((r) => r.canonicalPath),
  );
  activeTargets.add('/');
  activeTargets.add('/rss.xml');
  // Moment tombstones may still be redirect targets (static 404) while maps stay stable.
  for (const route of Object.values(routeMap)) {
    if (route.kind === 'moment' && route.canonicalPath) activeTargets.add(route.canonicalPath);
  }
  for (const meta of Object.values(metaMap)) {
    if (meta.state === 'active') activeTargets.add(meta.canonicalPath);
  }

  for (const entry of list) {
    if (entry.action === 'redirect' && !activeTargets.has(entry.targetPath)) {
      throw new Error(`non-active redirect target: ${entry.targetPath}`);
    }
  }

  const outPath = path.join(ROOT, 'data', 'legacy-url-map.json');
  await fs.writeFile(outPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        entries: list.length,
        redirects: list.filter((e) => e.action === 'redirect').length,
        queryKeys: list.filter((e) => e.queryKey).length,
        pathKeys: list.filter((e) => e.oldPath).length,
        out: path.relative(ROOT, outPath).replaceAll('\\', '/'),
      },
      null,
      2,
    ),
  );
}

await main();
