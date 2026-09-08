import slugify from 'slugify';

export const ROUTE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FIELD_ASTRO_PATH = 'astroPath';
export const FIELD_CONTENT_KIND = 'content_kind';
export const FIELD_MOMENT_IMAGES = 'moment_images';
export const FIELD_MOMENT_TOPICS = 'moment_topics';

/** Moments use the Typecho cid as a stable public id (`/moments/90/`). */
export const MOMENT_ROUTE_ID_RE = /^\d+$/;

export function normalizeRouteId(raw) {
  const base = slugify(String(raw || '').replaceAll('_', '-'), {
    lower: true,
    strict: true,
    trim: true,
  });
  if (!base || !ROUTE_ID_RE.test(base) || /^\d+$/.test(base)) return null;
  return base;
}

export function readPreferredRouteId({ astroPath, slug } = {}) {
  const field = String(astroPath ?? '').trim();
  if (field) {
    const routeId = normalizeRouteId(field);
    if (!routeId) {
      throw new Error(`invalid astroPath ${JSON.stringify(field)}`);
    }
    return { routeId, source: 'astroPath' };
  }
  const fromSlug = normalizeRouteId(slug);
  if (fromSlug) return { routeId: fromSlug, source: 'slug' };
  return null;
}

export function allocateRouteId(title, cid, used, preferred = null) {
  if (preferred?.routeId) {
    const id = preferred.routeId;
    if (!ROUTE_ID_RE.test(id) || /^\d+$/.test(id)) {
      throw new Error(`invalid preferred routeId ${id} for cid=${cid}`);
    }
    if (used.has(id)) {
      throw new Error(`preferred routeId ${id} already taken for cid=${cid}`);
    }
    used.add(id);
    return id;
  }

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

/**
 * Moments may be withdrawn (draft) then republished under the same cid.
 * Only permanently deleted moments (`disposition=gone`) refuse revival.
 */
export function ensureMomentRouteMap(routeMap, item, usedIds) {
  const key = String(item.cid);
  const existing = routeMap[key];
  if (existing) {
    if (existing.kind !== 'moment') {
      if (existing.state === 'active') {
        throw new Error(`cid=${key} is kind=${existing.kind}; refuse converting to moment`);
      }
      throw new Error(`cid=${key} has non-moment tombstone kind=${existing.kind}; refuse converting to moment`);
    }
    if (!MOMENT_ROUTE_ID_RE.test(existing.routeId)) {
      throw new Error(`invalid stored moment routeId for cid=${key}`);
    }
    if (existing.state === 'active') {
      usedIds.add(existing.routeId);
      existing.sourceSlug = item.slug;
      return existing;
    }
    if (existing.disposition === 'gone') {
      throw new Error(`cid=${key} moment was permanently deleted; refuse revive`);
    }
    // withdrawn / not_found tombstones: restore stable public identity
    existing.state = 'active';
    delete existing.disposition;
    usedIds.add(existing.routeId);
    existing.sourceSlug = item.slug;
    return existing;
  }

  const routeId = String(item.cid);
  if (!MOMENT_ROUTE_ID_RE.test(routeId)) {
    throw new Error(`invalid moment routeId ${routeId}`);
  }
  if (usedIds.has(routeId)) {
    throw new Error(`moment routeId ${routeId} already taken for cid=${key}`);
  }
  usedIds.add(routeId);
  const entry = {
    kind: 'moment',
    routeId,
    canonicalPath: `/moments/${routeId}/`,
    sourceSlug: item.slug,
    feedGuid: `urn:andy-y:moment:${item.cid}`,
    commentKey: `/moments/${routeId}/`,
    legacyPaths: [],
    state: 'active',
  };
  routeMap[key] = entry;
  return entry;
}

export function ensureRouteMap(routeMap, item, usedIds, extras = {}) {
  const key = String(item.cid);
  const existing = routeMap[key];
  if (existing) {
    if (existing.state === 'active') {
      if (existing.kind === 'moment') {
        throw new Error(`cid=${key} is a moment; refuse converting to ${item.type || 'post'}`);
      }
      if (!ROUTE_ID_RE.test(existing.routeId)) {
        throw new Error(`invalid stored routeId for cid=${key}`);
      }
      if (item.type === 'page' && !existing.canonicalPath) {
        throw new Error(`page cid=${key} missing canonicalPath in route-map`);
      }
      usedIds.add(existing.routeId);
      existing.sourceSlug = item.slug;
      return existing;
    }
    return existing;
  }

  if (item.type === 'page') {
    throw new Error(`page cid=${key} has no route-map entry; refuse defaulting to post`);
  }

  if (extras.contentKind === 'moment') {
    throw new Error(`cid=${key} marked moment but ensureRouteMap was called; use ensureMomentRouteMap`);
  }

  const preferred = readPreferredRouteId({
    astroPath: extras.astroPath,
    slug: item.slug,
  });
  const routeId = allocateRouteId(item.title, item.cid, usedIds, preferred);
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
