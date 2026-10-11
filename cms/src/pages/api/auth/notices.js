import { listAuthNotices } from '../../../lib/auth-notice.js';
import { withCmsDb } from '../../../lib/db.js';

export const prerender = false;

export async function GET() {
  try {
    const notices = await withCmsDb((db) => listAuthNotices(db));
    return new Response(JSON.stringify({ notices }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
