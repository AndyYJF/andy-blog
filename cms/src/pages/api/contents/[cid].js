import { withCmsDb } from '../../../lib/db.js';
import { deleteContent, exportContentRow, getContent, restoreContentRevision, saveContent } from '../../../lib/content-store.js';
import { contentWriteFromBody } from '../../../lib/content-write.js';
import { authorizeSession } from '../../../lib/auth-session.js';
import { readPublishState } from '../../../lib/publish-outbox.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET({ params, request, url }) {
  const cid = Number(params.cid);
  if (!Number.isSafeInteger(cid) || cid <= 0) return json({ error: 'bad cid' }, 400);
  try {
    const row = await withCmsDb(async (db) => {
      const session = await authorizeSession(db, {
        cookie: request.headers.get('cookie'),
        csrf: request.headers.get('x-csrf-token'),
        now: Math.floor(Date.now() / 1000),
      });
      if (!session.ok) return { denied: session };
      const found = await getContent(db, cid);
      if (!found) return null;
      if (url.searchParams.get('export') === '1') return { export: exportContentRow(found) };
      const publishState = await readPublishState(db, cid);
      return { ...found, publishState };
    });
    if (row?.denied) return json(row.denied, row.denied.status);
    if (!row) return json({ error: 'not found' }, 404);
    if (row.export) return json({ schemaVersion: 2, contents: [row.export] });
    return json(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}

export async function PUT({ params, request }) {
  const cid = Number(params.cid);
  if (!Number.isSafeInteger(cid) || cid <= 0) return json({ error: 'bad cid' }, 400);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (typeof body.text !== 'string' || !Number.isSafeInteger(body.baseRevision)) {
    return json({ error: 'text and baseRevision are required' }, 400);
  }
  const write = contentWriteFromBody(body);
  if (!write.ok) return json(write, write.status);
  try {
    const saved = await withCmsDb(async (db) => {
      const result = await saveContent(db, { cid, ...write.input });
      if (!result.ok) return result;
      const row = await getContent(db, cid);
      return { ...result, content: row, export: exportContentRow(row) };
    });
    if (!saved.ok) return json(saved, saved.status);
    return json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}

export async function POST({ params, request }) {
  const cid = Number(params.cid);
  if (!Number.isSafeInteger(cid) || cid <= 0) return json({ error: 'bad cid' }, 400);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!Number.isSafeInteger(body.baseRevision) || !Number.isSafeInteger(body.revision)) {
    return json({ error: 'baseRevision and revision are required' }, 400);
  }
  try {
    const restored = await withCmsDb((db) => restoreContentRevision(db, {
      cid,
      baseRevision: body.baseRevision,
      revision: body.revision,
    }));
    if (!restored.ok) return json(restored, restored.status);
    return json(restored);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}

export async function DELETE({ params, request }) {
  const cid = Number(params.cid);
  if (!Number.isSafeInteger(cid) || cid <= 0) return json({ error: 'bad cid' }, 400);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!Number.isSafeInteger(body.baseRevision)) return json({ error: 'baseRevision is required' }, 400);
  try {
    const removed = await withCmsDb((db) => deleteContent(db, { cid, baseRevision: body.baseRevision }));
    if (!removed.ok) return json(removed, removed.status);
    return json(removed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}
