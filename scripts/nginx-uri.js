/** Normalize a committed URL path to the value exposed by nginx `$uri`. */
export const normalizeNginxUriKey = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/')) throw new Error(`invalid nginx URI key: ${value}`);
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`invalid percent encoding in nginx URI key: ${value}`);
  }
  if (/[\r\n\0]/.test(decoded)) throw new Error(`unsafe nginx URI key: ${value}`);
  return decoded;
};
