import slugify from 'slugify';
import { normalizeMetaName } from './content-presentation.js';

const ROUTE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function claimKey(type, routeId) {
  return `${type}:${routeId}`;
}

export function allocateMetaRouteId(sourceSlug, mid, used, type) {
  let base = slugify(String(sourceSlug || '').replaceAll('_', '-'), {
    lower: true,
    strict: true,
    trim: true,
  });
  if (!base || !ROUTE_ID_RE.test(base) || /^\d+$/.test(base)) {
    base = `item-${mid}`;
  }
  let id = base;
  if (used.has(claimKey(type, id))) id = `${base}-${mid}`;
  if (!ROUTE_ID_RE.test(id)) throw new Error(`invalid meta routeId ${id} for mid=${mid}`);
  if (used.has(claimKey(type, id))) {
    throw new Error(`meta routeId collision unresolved for mid=${mid}`);
  }
  used.add(claimKey(type, id));
  return id;
}

export function encodeTypechoMetaSlug(slug) {
  return encodeURIComponent(String(slug));
}

export function ensureMetaRoute(metaMap, meta, usedIds) {
  const key = String(meta.mid);
  const existing = metaMap[key];
  if (existing) {
    if (existing.state === 'active') {
      if (!ROUTE_ID_RE.test(existing.routeId)) {
        throw new Error(`invalid stored meta routeId for mid=${key}`);
      }
      usedIds.add(claimKey(existing.type, existing.routeId));
      existing.name = normalizeMetaName(meta.name, meta.mid);
      existing.sourceSlug = meta.slug;
      return existing;
    }
    return existing;
  }

  if (meta.type !== 'category' && meta.type !== 'tag') {
    throw new Error(`unsupported meta type ${meta.type} for mid=${key}`);
  }

  const routeId = allocateMetaRouteId(meta.slug, meta.mid, usedIds, meta.type);
  const encoded = encodeTypechoMetaSlug(meta.slug);
  const entry = {
    type: meta.type,
    routeId,
    canonicalPath: `/${meta.type}/${routeId}/`,
    name: normalizeMetaName(meta.name, meta.mid),
    sourceSlug: meta.slug,
    legacyPaths: [
      `/index.php/${meta.type}/${encoded}/`,
      `/${meta.type}/${encoded}/`,
    ],
    state: 'active',
  };
  metaMap[key] = entry;
  return entry;
}

export function ensureMetaRouteMap(metaMap, metas) {
  const usedIds = new Set(
    Object.values(metaMap)
      .filter((entry) => entry.state === 'active')
      .map((entry) => claimKey(entry.type, entry.routeId)),
  );
  for (const meta of metas || []) {
    if (meta.type !== 'category' && meta.type !== 'tag') continue;
    ensureMetaRoute(metaMap, meta, usedIds);
  }
  return metaMap;
}
