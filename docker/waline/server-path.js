/** Shared pathname helpers for Waline policy gate (safe to import from tests). */

export function isCommentWritePath(pathname) {
  if (!pathname) return false;
  return pathname === '/api/comment' || pathname.startsWith('/api/comment/');
}

export function isApiPath(pathname) {
  return typeof pathname === 'string' && pathname.startsWith('/api/');
}

export function isSafeMethod(method) {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}
