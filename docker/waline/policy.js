/**
 * Comment-policy middleware helpers for the Waline wrapper.
 * Pure functions — unit-tested without Docker.
 */

export function normalizeCommentPath(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.trim();
  if (!p) return null;
  if (!p.startsWith('/')) p = `/${p}`;
  // reject traversal / host injection
  if (p.includes('://') || p.includes('\\') || p.includes('..')) return null;
  if (!p.endsWith('/')) p = `${p}/`;
  // collapse duplicate slashes
  p = p.replace(/\/{2,}/g, '/');
  // only allow path-like keys
  if (!/^\/[a-z0-9/_-]+\/$/i.test(p)) return null;
  return p;
}

export function extractPathFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  return normalizeCommentPath(body.url ?? body.path ?? null);
}

/**
 * @param {{ writeEnabled: boolean, entries: Record<string, { writable?: boolean }> }} policy
 * @param {string} method
 * @param {string | null} commentKey
 */
export function authorizeCommentWrite(policy, method, commentKey) {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
    return { ok: true, reason: 'read' };
  }
  // Admin update/delete stay with Waline auth — only block create/reply posts
  // that carry a comment path. Without a path we refuse.
  if (!policy?.writeEnabled) {
    return { ok: false, status: 403, reason: 'writeEnabled=false' };
  }
  if (!commentKey) {
    return { ok: false, status: 403, reason: 'missing-or-invalid-path' };
  }
  const entry = policy.entries?.[commentKey];
  if (!entry) {
    return { ok: false, status: 403, reason: 'unknown-key' };
  }
  if (entry.writable !== true) {
    return { ok: false, status: 403, reason: 'entry-not-writable' };
  }
  return { ok: true, reason: 'allowed' };
}

export function loadPolicyFile(fs, filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const policy = JSON.parse(raw);
  if (typeof policy.writeEnabled !== 'boolean' || typeof policy.entries !== 'object') {
    throw new Error('invalid comment-policy shape');
  }
  return policy;
}
