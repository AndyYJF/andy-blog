import { createWriteLimiter, refuseWriteRate } from './lib/rate-limit.js';
import { authorizePasskeyChange, authorizeSession, authorizeWrite, authWriteGate } from './lib/auth-session.js';
import { REAUTH_SECONDS } from './lib/auth-credentials.js';
import { CMS_ORIGIN } from './lib/auth-bootstrap.js';
import { applyCmsCsp, createCspNonce } from './lib/csp.js';
import { withCmsDb } from './lib/db.js';

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const writeLimiter = createWriteLimiter();

const WRITE = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function crossOriginWriteRefusal(request) {
  if (!WRITE.has(request.method)) return null;
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === 'null' || origin !== CMS_ORIGIN) return 'cross-origin write refused';
  return null;
}

export async function onRequest(context, next) {
  const nonce = createCspNonce();
  context.locals ??= {};
  context.locals.cspNonce = nonce;
  const finish = (response) => applyCmsCsp(response, context.request, nonce);
  if (!isLoopback(context.clientAddress)) {
    return finish(new Response('CMS prototype listens for loopback clients only', { status: 403 }));
  }
  const refused = crossOriginWriteRefusal(context.request);
  if (refused) return finish(new Response(refused, { status: 403 }));
  const limited = refuseWriteRate({
    method: context.request.method,
    peer: context.clientAddress,
    realIp: context.request.headers.get('x-real-ip'),
    forwardedFor: context.request.headers.get('x-forwarded-for'),
    trustedProxy: process.env.CMS_TRUSTED_PROXY,
    limiter: writeLimiter,
    now: Date.now(),
  });
  if (limited) {
    return finish(new Response(limited.body, {
      status: limited.status,
      headers: { 'retry-after': String(limited.retryAfter) },
    }));
  }
  const pathname = new URL(context.request.url).pathname;
  const gate = authWriteGate(context.request.method, pathname);
  if (gate !== 'none') {
    try {
      const decision = await withCmsDb((db) => {
        const args = {
          cookie: context.request.headers.get('cookie'),
          csrf: context.request.headers.get('x-csrf-token'),
          now: Math.floor(Date.now() / 1000),
        };
        if (gate === 'write') return authorizeWrite(db, args);
        if (gate === 'passkey') return authorizePasskeyChange(db, { ...args, reauthSeconds: REAUTH_SECONDS });
        return authorizeSession(db, args);
      });
      if (!decision.ok) return finish(new Response(decision.error, { status: decision.status }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'database unavailable';
      return finish(new Response(message, { status: 503 }));
    }
  }
  return finish(await next());
}
