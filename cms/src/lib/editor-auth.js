export const CSRF_STORAGE_KEY = 'cms-csrf';

export function editorWriteHeaders(csrf) {
  const headers = { 'content-type': 'application/json' };
  if (typeof csrf === 'string' && csrf.length > 0) headers['x-csrf-token'] = csrf;
  return headers;
}

export function readStoredCsrf(storage) {
  try {
    const value = storage?.getItem(CSRF_STORAGE_KEY);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function rememberCsrf(storage, token) {
  if (!storage || typeof token !== 'string' || token.length === 0) return false;
  storage.setItem(CSRF_STORAGE_KEY, token);
  return true;
}

export function forgetCsrf(storage) {
  try {
    storage?.removeItem(CSRF_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
