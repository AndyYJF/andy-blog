import crypto from 'node:crypto';

export const SOURCE_NAMESPACE = 'typecho';
export const STATUS_MAP = Object.freeze({
  approved: 'approved',
  waiting: 'waiting',
  spam: 'spam',
});

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trimEnd();
}

function positiveInteger(value, field, { allowZero = false } = {}) {
  const n = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(n) || n < minimum) {
    throw new Error(`invalid ${field}: ${value}`);
  }
  return n;
}

export function validateSourceShape(rows) {
  if (!Array.isArray(rows)) throw new Error('source comments must be a JSON array');
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('source comment row must be an object');
    }
    const coid = positiveInteger(row.coid, 'coid');
    positiveInteger(row.cid, `cid for coid=${coid}`);
    positiveInteger(row.created, `created for coid=${coid}`);
    positiveInteger(row.parent ?? 0, `parent for coid=${coid}`, { allowZero: true });
    if (seen.has(coid)) throw new Error(`duplicate coid=${coid}`);
    seen.add(coid);
    if (typeof row.type !== 'string' || !row.type) throw new Error(`invalid type for coid=${coid}`);
    if (typeof row.status !== 'string' || !row.status) throw new Error(`invalid status for coid=${coid}`);
  }
}

export function sourceHash(row, commentKey) {
  return sha256(
    JSON.stringify({
      version: 2,
      coid: Number(row.coid),
      cid: Number(row.cid),
      commentKey,
      author: row.author ?? '',
      mail: row.mail ?? '',
      link: row.url ?? '',
      ip: row.ip ?? '',
      ua: row.agent ?? '',
      text: normalizeText(row.text),
      status: row.status,
      parent: Number(row.parent) || 0,
      created: Number(row.created),
      type: row.type,
    }),
  );
}

export function selectMigratable(rows) {
  const selected = [];
  const archived = [];
  for (const row of rows) {
    if (row.type !== 'comment') {
      archived.push({ coid: Number(row.coid), reason: `type=${row.type}` });
      continue;
    }
    if (!STATUS_MAP[row.status]) {
      archived.push({ coid: Number(row.coid), reason: `status=${row.status}` });
      continue;
    }
    selected.push(row);
  }
  selected.sort((a, b) => Number(a.coid) - Number(b.coid));
  archived.sort((a, b) => a.coid - b.coid);
  return { selected, archived };
}

export function validateParentGraph(rows, routeMap) {
  const byCoid = new Map(rows.map((row) => [Number(row.coid), row]));
  const errors = [];
  for (const row of rows) {
    const coid = Number(row.coid);
    const parent = Number(row.parent) || 0;
    if (parent !== 0 && !byCoid.has(parent)) {
      errors.push(`orphan parent: coid=${coid} parent=${parent}`);
      continue;
    }
    const seen = new Set([coid]);
    let current = parent;
    while (current) {
      if (seen.has(current)) {
        errors.push(`parent cycle involving coid=${coid}`);
        break;
      }
      seen.add(current);
      const parentRow = byCoid.get(current);
      current = parentRow ? Number(parentRow.parent) || 0 : 0;
    }

    const route = routeMap[String(row.cid)];
    if (!route || route.state !== 'active' || !route.commentKey) {
      errors.push(`unpublished cid for coid=${coid} cid=${row.cid}`);
    }
  }
  if (errors.length) {
    const error = new Error(`parent-graph validation failed:\n${errors.join('\n')}`);
    error.errors = errors;
    throw error;
  }
  return byCoid;
}

export function rootCoid(row, byCoid) {
  let current = row;
  const seen = new Set([Number(row.coid)]);
  while (Number(current.parent) > 0) {
    const parent = Number(current.parent);
    if (seen.has(parent)) throw new Error(`cycle while resolving root for ${row.coid}`);
    seen.add(parent);
    current = byCoid.get(parent);
    if (!current) throw new Error(`missing parent ${parent}`);
  }
  return Number(current.coid);
}

export function buildCommentPayload(row, commentKey) {
  const createdEpoch = Number(row.created);
  return {
    userId: null,
    comment: normalizeText(row.text),
    insertedEpoch: createdEpoch,
    ip: row.ip || '',
    link: row.url || '',
    mail: row.mail || '',
    nick: row.author || '匿名',
    pid: null,
    rid: null,
    sticky: 0,
    status: STATUS_MAP[row.status],
    like: 0,
    ua: row.agent || '',
    url: commentKey,
    createdEpoch,
    updatedEpoch: createdEpoch,
  };
}

export function buildPreparedSource(sourceRows, routeMap) {
  validateSourceShape(sourceRows);
  const { selected, archived } = selectMigratable(sourceRows);
  const byCoid = validateParentGraph(selected, routeMap);
  const expected = selected.map((row) => {
    const commentKey = routeMap[String(row.cid)].commentKey;
    return {
      source: SOURCE_NAMESPACE,
      legacyCoid: Number(row.coid),
      sourceHash: sourceHash(row, commentKey),
      row,
      commentKey,
      payload: buildCommentPayload(row, commentKey),
    };
  });
  return { selected, archived, byCoid, expected };
}

export function expectedParentIds(row, byCoid, walineIdByCoid) {
  const parent = Number(row.parent) || 0;
  if (parent === 0) return { pid: null, rid: null };
  const pid = walineIdByCoid.get(parent);
  const root = rootCoid(row, byCoid);
  const rid = walineIdByCoid.get(root);
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(rid)) {
    throw new Error(`missing Waline parent mapping for coid=${row.coid}`);
  }
  return { pid, rid };
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export function compareCommentRow(expected, actual, parentIds) {
  const fields = [];
  const checks = {
    comment: normalizeText(actual.comment),
    insertedEpoch: Number(actual.insertedEpoch),
    ip: actual.ip || '',
    link: actual.link || '',
    mail: actual.mail || '',
    nick: actual.nick || '',
    pid: nullableNumber(actual.pid),
    rid: nullableNumber(actual.rid),
    sticky: Number(actual.sticky ?? 0),
    status: actual.status,
    like: Number(actual.like ?? 0),
    ua: actual.ua || '',
    url: actual.url,
    createdEpoch: Number(actual.createdEpoch),
    updatedEpoch: Number(actual.updatedEpoch),
  };
  const wanted = { ...expected.payload, ...parentIds };
  for (const [field, value] of Object.entries(wanted)) {
    if (field === 'userId') continue;
    if (checks[field] !== value) fields.push(field);
  }
  return fields;
}

export function summarizePreparedSource(prepared) {
  return {
    source: prepared.selected.length + prepared.archived.length,
    selected: prepared.selected.length,
    archived: prepared.archived.length,
    approved: prepared.selected.filter((row) => row.status === 'approved').length,
    waiting: prepared.selected.filter((row) => row.status === 'waiting').length,
    spam: prepared.selected.filter((row) => row.status === 'spam').length,
  };
}
