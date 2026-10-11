const WRITE = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const LOOPBACK = new Set(['127.0.0.1', '::1']);

export function normalizePeer(address) {
  const value = String(address || '').trim();
  if (value === '::ffff:127.0.0.1') return '127.0.0.1';
  return value;
}

export function trustedLoopbackProxy(value) {
  const peer = normalizePeer(value);
  return LOOPBACK.has(peer) ? peer : '';
}

function forwardedAddress(value) {
  const last = String(value || '').split(',').map((part) => part.trim()).filter(Boolean).at(-1) || '';
  if (!/^[0-9a-fA-F:.]+$/.test(last)) return '';
  return normalizePeer(last);
}

export function rateLimitKey({ peer, realIp, forwardedFor, trustedProxy }) {
  const direct = normalizePeer(peer) || 'unknown';
  const trust = trustedLoopbackProxy(trustedProxy);
  if (!trust || direct !== trust) return direct;
  return forwardedAddress(forwardedFor) || forwardedAddress(realIp) || direct;
}

export function createWriteLimiter({ limit = 40, windowMs = 10_000 } = {}) {
  const hits = new Map();
  return {
    consume(key, now) {
      const at = Number(now);
      const fresh = (hits.get(key) || []).filter((ts) => at - ts < windowMs);
      if (fresh.length >= limit) {
        hits.set(key, fresh);
        return { allowed: false, retryAfterMs: Math.max(0, windowMs - (at - fresh[0])) };
      }
      fresh.push(at);
      hits.set(key, fresh);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

export function refuseWriteRate({ method, peer, realIp, forwardedFor, trustedProxy, limiter, now }) {
  if (!WRITE.has(method)) return null;
  const key = rateLimitKey({ peer, realIp, forwardedFor, trustedProxy });
  const decision = limiter.consume(key, now);
  if (decision.allowed) return null;
  return {
    status: 429,
    body: 'write rate limit exceeded',
    retryAfter: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
  };
}
