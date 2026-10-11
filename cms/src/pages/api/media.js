import { MOCK_IMAGE_MAX_BYTES, storeMockImage } from '../../lib/media-mock.js';
import { withCmsDb } from '../../lib/db.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function readLimitedBytes(request, maxBytes = MOCK_IMAGE_MAX_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: 'image size is outside the mock limit' };
  }
  if (!request.body) return { ok: false, status: 400, error: 'image bytes are required' };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, error: 'image size is outside the mock limit' };
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) return { ok: false, status: 400, error: 'image bytes are required' };
  return { ok: true, bytes: Buffer.concat(chunks) };
}

export async function POST({ request }) {
  const limited = await readLimitedBytes(request);
  if (!limited.ok) return json({ error: limited.error }, limited.status);
  try {
    const stored = await withCmsDb((db) => storeMockImage(db, limited.bytes));
    if (!stored.ok) return json({ error: stored.error, provider: 'unverified' }, stored.status || 400);
    return json(stored);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}
