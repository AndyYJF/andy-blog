import slugify from 'slugify';

export const ROUTE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FIELD_ASTRO_PATH = 'astroPath';

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

export function ensureRouteMap(routeMap, item, usedIds, extras = {}) {
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
      existing.sourceSlug = item.slug;
      return existing;
    }
    return existing;
  }

  if (item.type === 'page') {
    throw new Error(`page cid=${key} has no route-map entry; refuse defaulting to post`);
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
