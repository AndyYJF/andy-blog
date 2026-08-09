import crypto from 'node:crypto';

export const REQUIRED_COMMENT_COLUMNS = Object.freeze([
  'coid', 'cid', 'created', 'author', 'authorId', 'ownerId', 'mail', 'url',
  'ip', 'agent', 'text', 'type', 'status', 'parent',
]);

export const READONLY_GUARD_TRIGGERS = Object.freeze({
  INSERT: 'astro_stage10_typecho_comments_no_insert',
  UPDATE: 'astro_stage10_typecho_comments_no_update',
  DELETE: 'astro_stage10_typecho_comments_no_delete',
});

const GUARD_MARKER = 'TYPECHO_COMMENTS_READ_ONLY_AFTER_ASTRO_CUTOVER';

function safeIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`invalid ${label}: ${value}`);
  return `\`${value}\``;
}

function safeInteger(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return number;
}

function optionalText(value) {
  return value === null || value === undefined ? null : String(value);
}

export function normalizeExportRow(row) {
  const coid = safeInteger(row.coid, 'coid');
  return {
    coid,
    cid: safeInteger(row.cid, `cid for coid=${coid}`),
    created: safeInteger(row.created, `created for coid=${coid}`),
    author: String(row.author ?? ''),
    authorId: safeInteger(row.authorId ?? 0, `authorId for coid=${coid}`, { allowZero: true }),
    ownerId: safeInteger(row.ownerId ?? 0, `ownerId for coid=${coid}`, { allowZero: true }),
    mail: String(row.mail ?? ''),
    url: optionalText(row.url),
    ip: String(row.ip ?? ''),
    agent: String(row.agent ?? ''),
    text: String(row.text ?? ''),
    type: String(row.type ?? ''),
    status: String(row.status ?? ''),
    parent: safeInteger(row.parent ?? 0, `parent for coid=${coid}`, { allowZero: true }),
  };
}

export function validateSchemaRows(rows) {
  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  const missing = REQUIRED_COMMENT_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length) throw new Error(`Typecho comments schema missing columns: ${missing.join(',')}`);
}

export function validateGuardRows(rows) {
  if (rows.length !== 3) throw new Error(`readonly guard count mismatch: expected 3, got ${rows.length}`);
  const byEvent = new Map(rows.map((row) => [row.EVENT_MANIPULATION, row]));
  for (const [event, triggerName] of Object.entries(READONLY_GUARD_TRIGGERS)) {
    const row = byEvent.get(event);
    if (!row || row.TRIGGER_NAME !== triggerName || row.ACTION_TIMING !== 'BEFORE') {
      throw new Error(`readonly guard mismatch for ${event}`);
    }
    if (!String(row.ACTION_STATEMENT).includes(GUARD_MARKER)) {
      throw new Error(`readonly guard marker missing for ${event}`);
    }
  }
}

export function serializeFixedExport(rows) {
  const normalized = rows.map(normalizeExportRow).sort((a, b) => a.coid - b.coid);
  const seen = new Set();
  for (const row of normalized) {
    if (seen.has(row.coid)) throw new Error(`duplicate coid=${row.coid}`);
    seen.add(row.coid);
  }
  const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  const grouped = {};
  for (const row of normalized) {
    const key = `${row.type}:${row.status}`;
    grouped[key] = (grouped[key] || 0) + 1;
  }
  return {
    rows: normalized,
    bytes,
    summary: {
      rows: normalized.length,
      maxCoid: normalized.reduce((maximum, row) => Math.max(maximum, row.coid), 0),
      replies: normalized.filter((row) => row.parent > 0).length,
      groups: Object.fromEntries(Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right))),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

export async function readFixedExport({ connection, database, commentsTable }) {
  const quotedTable = safeIdentifier(commentsTable, 'comments table');
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION READ ONLY');
  try {
    const [schemaRows] = await connection.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
      [database, commentsTable],
    );
    validateSchemaRows(schemaRows);
    const [guardRows] = await connection.execute(
      `SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA=? AND EVENT_OBJECT_TABLE=?
         AND TRIGGER_NAME IN (?,?,?)
       ORDER BY EVENT_MANIPULATION`,
      [database, commentsTable, ...Object.values(READONLY_GUARD_TRIGGERS)],
    );
    validateGuardRows(guardRows);
    const [rows] = await connection.query(
      `SELECT ${REQUIRED_COMMENT_COLUMNS.map((column) => safeIdentifier(column, 'column')).join(', ')}
       FROM ${quotedTable} ORDER BY \`coid\``,
    );
    const fixed = serializeFixedExport(rows);
    await connection.commit();
    return fixed;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
