import { withCmsDb } from '../../lib/db.js';
import { simulatePreviewJob } from '../../lib/preview-job.js';

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
  const cid = body.cid;
  const baseRevision = body.baseRevision;
  if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(baseRevision)) {
    return json({ error: 'cid and baseRevision are required' }, 400);
  }
  try {
    const result = await withCmsDb((db) => simulatePreviewJob(db, { cid, baseRevision, body }));
    if (!result.ok) return json(result, result.status);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}
