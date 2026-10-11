import { approveTranslation, readTranslations, setTranslationPublication } from '../../lib/i18n-edit.js';
import { withCmsDb } from '../../lib/db.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET({ request, url }) {
  const cid = Number(url.searchParams.get('cid'));
  const locale = url.searchParams.get('locale') || '';
  try {
    const result = await withCmsDb((db) => readTranslations(db, {
      cid,
      locale,
      cookie: request.headers.get('cookie'),
      csrf: request.headers.get('x-csrf-token'),
      now: Math.floor(Date.now() / 1000),
    }));
    if (!result.ok) return json(result, result.status);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const cid = body.cid;
  const locale = body.locale;
  if (!Number.isSafeInteger(cid) || cid <= 0 || typeof locale !== 'string') {
    return json({ error: 'cid and locale are required' }, 400);
  }
  try {
    const result = await withCmsDb((db) => {
      if (body.action === 'approve') {
        return approveTranslation(db, {
          cid,
          locale,
          versionId: body.versionId,
          digest: body.digest,
          proofreader: body.proofreader,
        });
      }
      if (body.action === 'publication') {
        if (body.state !== 'enabled' && body.state !== 'disabled') {
          return { ok: false, status: 400, error: 'bad publication state' };
        }
        return setTranslationPublication(db, { cid, locale, state: body.state });
      }
      return { ok: false, status: 400, error: 'bad translation action' };
    });
    if (!result.ok) return json(result, result.status);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return json({ error: message }, 503);
  }
}
