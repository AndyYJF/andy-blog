import { previewBody, PREVIEW_LIMITS, createPreviewGate } from '../../lib/preview-body.js';

export const prerender = false;

const gate = createPreviewGate();

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 });
  }
  if (typeof body.text !== 'string') {
    return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 });
  }
  try {
    const result = await gate.run(() => Promise.resolve(previewBody(body.text, Number(body.cid) || 0)));
    const status = result.ok ? 200 : 413;
    return new Response(JSON.stringify({ ...result, debounceMs: PREVIEW_LIMITS.debounceMs }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'preview failed';
    const status = message.includes('timed out') ? 503 : 500;
    return new Response(JSON.stringify({ error: message }), { status });
  }
}
