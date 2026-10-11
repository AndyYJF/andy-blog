import { withCmsDb } from '../../../lib/db.js';
import { saveMeta } from '../../../lib/meta-store.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  try {
    const saved = await withCmsDb((db) => saveMeta(db, {
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
