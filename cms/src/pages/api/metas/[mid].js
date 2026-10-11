import { withCmsDb } from '../../../lib/db.js';
import { deleteMeta, saveMeta } from '../../../lib/meta-store.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function PUT({ params, request }) {
  const mid = Number(params.mid);
  if (!Number.isSafeInteger(mid) || mid <= 0) return json({ error: 'bad mid' }, 400);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  try {
    const saved = await withCmsDb((db) => saveMeta(db, {
      mid,
      baseSlug: body.baseSlug,
      name: body.name,
      slug: body.slug,
      type: body.type,
      description: body.description,
      order: body.order,
      parent: body.parent,
    }));
    if (!saved.ok) return json(saved, saved.status);
    return json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}

export async function DELETE({ params, request }) {
  const mid = Number(params.mid);
  if (!Number.isSafeInteger(mid) || mid <= 0) return json({ error: 'bad mid' }, 400);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  try {
    const removed = await withCmsDb((db) => deleteMeta(db, { mid, baseSlug: body.baseSlug }));
    if (!removed.ok) return json(removed, removed.status);
    return json(removed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}
