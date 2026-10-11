export function contentWriteFromBody(body) {
  if (!body || typeof body.text !== 'string' || !Number.isSafeInteger(body.baseRevision)) {
    return { ok: false, status: 400, error: 'text and baseRevision are required' };
  }
  const input = {
    title: body.title,
    slug: body.slug,
    text: body.text,
    baseRevision: body.baseRevision,
    newlineNormalization: body.newlineNormalization || null,
    type: body.type,
    status: body.status,
  };
  if (Object.hasOwn(body, 'password')) input.password = body.password;
  if (Object.hasOwn(body, 'fields')) {
    if (!Array.isArray(body.fields) || body.fields.some((field) => (
      !field || typeof field.name !== 'string' || typeof field.type !== 'string'
    ))) {
      return { ok: false, status: 400, error: 'fields must be a list of named values' };
    }
    input.fields = body.fields.map((field) => ({
      name: field.name,
      type: field.type,
      str_value: field.str_value ?? null,
      int_value: field.int_value ?? null,
      float_value: field.float_value ?? null,
    }));
  }
  if (Object.hasOwn(body, 'relationshipMids')) {
    if (!Array.isArray(body.relationshipMids) || body.relationshipMids.some((mid) => (
      !Number.isSafeInteger(mid) || mid <= 0
    ))) {
      return { ok: false, status: 400, error: 'relationshipMids must be positive integers' };
    }
    input.relationshipMids = body.relationshipMids;
  }
  for (const key of ['allowComment', 'allowPing', 'allowFeed']) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    const flag = value === true || value === 1 || value === '1'
      ? '1'
      : (value === false || value === 0 || value === '0' ? '0' : null);
    if (!flag) return { ok: false, status: 400, error: `${key} must be 0 or 1` };
    input[key] = flag;
  }
  return { ok: true, input };
}
