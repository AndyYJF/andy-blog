import { randomBytes } from 'node:crypto';

const HASH = /^'sha(?:256|384|512)-[A-Za-z0-9+/=]+'$/;

const EMBED_FRAMES = ['https://player.bilibili.com', 'https://music.163.com'];

export function createCspNonce() {
  return randomBytes(16).toString('base64');
}

export function hashesFromPolicy(policy, directive) {
  if (!policy) return [];
  const hashes = [];
  for (const part of String(policy).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] !== directive && tokens[0] !== `${directive}-elem`) continue;
    for (const token of tokens.slice(1)) {
      if (HASH.test(token) && !hashes.includes(token)) hashes.push(token);
    }
  }
  return hashes;
}

export function cspKindFor(pathname) {
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname === '/preview-frame' || pathname.startsWith('/preview-frame/')) return 'preview';
  return 'app';
}

export function cmsContentSecurityPolicy({ kind, scriptHashes = [], styleHashes = [], nonce = '' }) {
  if (kind === 'api') {
    return [
      "default-src 'none'",
      "script-src 'none'",
      "style-src 'none'",
      "img-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; ');
  }
  const nonceToken = nonce ? `'nonce-${nonce}'` : '';
  const script = ["'self'", ...scriptHashes, nonceToken].filter(Boolean).join(' ');
  const style = ["'self'", ...styleHashes, nonceToken].filter(Boolean).join(' ');
  const img = kind === 'preview'
    ? "img-src 'self' data: blob: https:"
    : "img-src 'self' data: blob:";
  const frame = kind === 'preview'
    ? `frame-src 'self' ${EMBED_FRAMES.join(' ')}`
    : "frame-src 'self'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "script-src-attr 'none'",
    `style-src ${style}`,
    "style-src-attr 'none'",
    img,
    "connect-src 'self'",
    frame,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join('; ');
}

export function applyCmsCsp(response, request, nonce) {
  const headers = new Headers(response.headers);
  const existing = headers.get('content-security-policy') || '';
  const { pathname } = new URL(request.url);
  const kind = cspKindFor(pathname);
  headers.set('content-security-policy', cmsContentSecurityPolicy({
    kind,
    nonce: kind === 'api' ? '' : nonce,
    scriptHashes: hashesFromPolicy(existing, 'script-src'),
    styleHashes: hashesFromPolicy(existing, 'style-src'),
  }));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
