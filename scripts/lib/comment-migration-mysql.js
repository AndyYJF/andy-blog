import {
  SOURCE_NAMESPACE,
  compareCommentRow,
  expectedParentIds,
  summarizePreparedSource,
} from './comment-migration-core.js';

const REQUIRED_COLUMNS = Object.freeze({
  wl_Comment: [
    'id', 'user_id', 'comment', 'insertedAt', 'ip', 'link', 'mail', 'nick',
    'pid', 'rid', 'sticky', 'status', 'like', 'ua', 'url', 'createdAt', 'updatedAt',
  ],
  astro_comment_migration_map: [
    'source', 'legacy_coid', 'waline_id', 'source_hash', 'migrated_at',
  ],
});

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`unsafe MySQL identifier: ${value}`);
  return `\`${value}\``;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeJoinedRow(row) {
  if (row.comment_id === null || row.comment_id === undefined) return null;
  return {
    id: Number(row.comment_id),
    comment: row.comment,
    insertedEpoch: Number(row.inserted_epoch),
    ip: row.ip,
    link: row.link,
    mail: row.mail,
    nick: row.nick,
    pid: numberOrNull(row.pid),
    rid: numberOrNull(row.rid),
    sticky: Number(row.sticky ?? 0),
    status: row.status,
    like: Number(row.like_count ?? 0),
    ua: row.ua,
    url: row.url,
    createdEpoch: Number(row.created_epoch),
    updatedEpoch: Number(row.updated_epoch),
  };
}

export async function validateMysqlSchema(connection, database) {
  const [columns] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN ('wl_Comment', 'astro_comment_migration_map')
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const found = new Map();
  for (const row of columns) {
    if (!found.has(row.table_name)) found.set(row.table_name, new Set());
    found.get(row.table_name).add(row.column_name);
  }
  const missing = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = found.get(table) || new Set();
    for (const column of required) {
      if (!actual.has(column)) missing.push(`${table}.${column}`);
    }
  }

  const [tables] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_COLLATION AS table_collation
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN ('wl_Comment', 'astro_comment_migration_map')`,
    [database],
  );
  const tableMeta = new Map(tables.map((row) => [row.table_name, row]));
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    const meta = tableMeta.get(table);
    if (!meta) {
      missing.push(`${table} table`);
      continue;
    }
    if (String(meta.engine).toLowerCase() !== 'innodb') missing.push(`${table} engine=InnoDB`);
    if (!String(meta.table_collation || '').toLowerCase().startsWith('utf8mb4_')) {
      missing.push(`${table} utf8mb4 collation`);
    }
  }

  const [indexRows] = await connection.execute(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique,
            SEQ_IN_INDEX AS seq_in_index, COLUMN_NAME AS column_name
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'astro_comment_migration_map'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  const indexes = new Map();
  for (const row of indexRows) {
    if (!indexes.has(row.index_name)) indexes.set(row.index_name, []);
    indexes.get(row.index_name).push({
      column: row.column_name,
      nonUnique: Number(row.non_unique),
      sequence: Number(row.seq_in_index),
    });
  }
  const primary = indexes.get('PRIMARY') || [];
  if (primary.map((item) => item.column).join(',') !== 'source,legacy_coid') {
    missing.push('migration-map PRIMARY KEY(source, legacy_coid)');
  }
  const hasWalineUnique = [...indexes.values()].some((items) => (
    items.length === 1 && items[0].column === 'waline_id' && items[0].nonUnique === 0
  ));
  if (!hasWalineUnique) missing.push('unique migration-map waline_id index');

  if (missing.length) {
    const error = new Error(`production Waline schema is not ready: ${missing.join(', ')}`);
    error.code = 'SCHEMA_NOT_READY';
    error.missing = missing;
    throw error;
  }
  return { ok: true, database, tables: Object.keys(REQUIRED_COLUMNS) };
}

async function loadMappedState(connection, database, { forUpdate = false } = {}) {
  const db = quoteIdentifier(database);
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await connection.execute(
    `SELECT m.legacy_coid, m.waline_id, m.source_hash,
            c.id AS comment_id, c.comment,
            UNIX_TIMESTAMP(c.insertedAt) AS inserted_epoch,
            c.ip, c.link, c.mail, c.nick, c.pid, c.rid, c.sticky, c.status,
            c.\`like\` AS like_count, c.ua, c.url,
            UNIX_TIMESTAMP(c.createdAt) AS created_epoch,
            UNIX_TIMESTAMP(c.updatedAt) AS updated_epoch
       FROM ${db}.astro_comment_migration_map m
       LEFT JOIN ${db}.wl_Comment c ON c.id = m.waline_id
      WHERE m.source = ?
      ORDER BY m.legacy_coid${suffix}`,
    [SOURCE_NAMESPACE],
  );
  return rows.map((row) => ({
    legacyCoid: Number(row.legacy_coid),
    walineId: Number(row.waline_id),
    sourceHash: row.source_hash,
    comment: normalizeJoinedRow(row),
  }));
}

async function insertComment(connection, database, expected) {
  const db = quoteIdentifier(database);
  const p = expected.payload;
  const [result] = await connection.execute(
    `INSERT INTO ${db}.wl_Comment
       (user_id, comment, insertedAt, ip, link, mail, nick, pid, rid, sticky,
        status, \`like\`, ua, url, createdAt, updatedAt)
     VALUES
       (NULL, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?,
        FROM_UNIXTIME(?), FROM_UNIXTIME(?))`,
    [
      p.comment, p.insertedEpoch, p.ip, p.link, p.mail, p.nick, p.sticky,
      p.status, p.like, p.ua, p.url, p.createdEpoch, p.updatedEpoch,
    ],
  );
  const walineId = Number(result.insertId);
  if (!Number.isSafeInteger(walineId) || walineId < 1) throw new Error('MySQL did not return a valid Waline insertId');
  await connection.execute(
    `INSERT INTO ${db}.astro_comment_migration_map
       (source, legacy_coid, waline_id, source_hash)
     VALUES (?, ?, ?, ?)`,
    [SOURCE_NAMESPACE, expected.legacyCoid, walineId, expected.sourceHash],
  );
  return walineId;
}

async function updateCommentBase(connection, database, walineId, expected) {
  const db = quoteIdentifier(database);
  const p = expected.payload;
  await connection.execute(
    `UPDATE ${db}.wl_Comment
        SET user_id = NULL,
            comment = ?, insertedAt = FROM_UNIXTIME(?), ip = ?, link = ?,
            mail = ?, nick = ?, sticky = ?, status = ?, \`like\` = ?, ua = ?,
            url = ?, createdAt = FROM_UNIXTIME(?), updatedAt = FROM_UNIXTIME(?)
      WHERE id = ?`,
    [
      p.comment, p.insertedEpoch, p.ip, p.link, p.mail, p.nick, p.sticky,
      p.status, p.like, p.ua, p.url, p.createdEpoch, p.updatedEpoch, walineId,
    ],
  );
  await connection.execute(
    `UPDATE ${db}.astro_comment_migration_map
        SET source_hash = ?, migrated_at = CURRENT_TIMESTAMP
      WHERE source = ? AND legacy_coid = ? AND waline_id = ?`,
    [expected.sourceHash, SOURCE_NAMESPACE, expected.legacyCoid, walineId],
  );
}

async function updateParents(connection, database, walineId, parentIds) {
  const db = quoteIdentifier(database);
  await connection.execute(
    `UPDATE ${db}.wl_Comment SET pid = ?, rid = ? WHERE id = ?`,
    [parentIds.pid, parentIds.rid, walineId],
  );
}

async function sweepAbsent(connection, database, absent) {
  if (!absent.length) return { deleted: 0, deletedLegacyCoids: [] };
  const db = quoteIdentifier(database);
  const walineIds = absent.map((item) => item.walineId);
  const idPlaceholders = placeholders(walineIds);
  const [dependentRows] = await connection.execute(
    `SELECT id, pid, rid
       FROM ${db}.wl_Comment
      WHERE (pid IN (${idPlaceholders}) OR rid IN (${idPlaceholders}))
        AND id NOT IN (${idPlaceholders})
      LIMIT 20`,
    [...walineIds, ...walineIds, ...walineIds],
  );
  if (dependentRows.length) {
    const error = new Error('absent-key sweep would orphan remaining Waline comments');
    error.code = 'SWEEP_WOULD_ORPHAN';
    error.commentIds = dependentRows.map((row) => Number(row.id));
    throw error;
  }
  await connection.execute(
    `DELETE FROM ${db}.wl_Comment WHERE id IN (${idPlaceholders})`,
    walineIds,
  );
  const legacyCoids = absent.map((item) => item.legacyCoid);
  await connection.execute(
    `DELETE FROM ${db}.astro_comment_migration_map
      WHERE source = ? AND legacy_coid IN (${placeholders(legacyCoids)})`,
    [SOURCE_NAMESPACE, ...legacyCoids],
  );
  return { deleted: absent.length, deletedLegacyCoids: legacyCoids.sort((a, b) => a - b) };
}

async function runPass(connection, database, prepared, { applySweep }) {
  let state = await loadMappedState(connection, database, { forUpdate: true });
  const stateByCoid = new Map(state.map((item) => [item.legacyCoid, item]));
  const sourceCoids = new Set(prepared.expected.map((item) => item.legacyCoid));
  const insertedLegacyCoids = [];
  const updatedLegacyCoids = new Set();
  const drift = [];

  for (const expected of prepared.expected) {
    const existing = stateByCoid.get(expected.legacyCoid);
    if (!existing) {
      const walineId = await insertComment(connection, database, expected);
      stateByCoid.set(expected.legacyCoid, {
        legacyCoid: expected.legacyCoid,
        walineId,
        sourceHash: expected.sourceHash,
        comment: { id: walineId, ...expected.payload },
      });
      insertedLegacyCoids.push(expected.legacyCoid);
      continue;
    }
    if (!existing.comment) {
      const error = new Error(`migration map points to missing Waline row for coid=${expected.legacyCoid}`);
      error.code = 'MAPPED_COMMENT_MISSING';
      throw error;
    }
    const ignoreExistingParents = {
      pid: numberOrNull(existing.comment.pid),
      rid: numberOrNull(existing.comment.rid),
    };
    const baseMismatch = compareCommentRow(expected, existing.comment, ignoreExistingParents)
      .filter((field) => field !== 'pid' && field !== 'rid');
    if (existing.sourceHash !== expected.sourceHash || baseMismatch.length) {
      await updateCommentBase(connection, database, existing.walineId, expected);
      updatedLegacyCoids.add(expected.legacyCoid);
      if (baseMismatch.length) drift.push({ coid: expected.legacyCoid, fields: baseMismatch });
    }
  }

  state = await loadMappedState(connection, database, { forUpdate: true });
  const refreshedByCoid = new Map(state.map((item) => [item.legacyCoid, item]));
  const walineIdByCoid = new Map(state.map((item) => [item.legacyCoid, item.walineId]));
  for (const expected of prepared.expected) {
    const mapped = refreshedByCoid.get(expected.legacyCoid);
    if (!mapped?.comment) throw new Error(`missing mapped comment after upsert for coid=${expected.legacyCoid}`);
    const wanted = expectedParentIds(expected.row, prepared.byCoid, walineIdByCoid);
    const actual = { pid: numberOrNull(mapped.comment.pid), rid: numberOrNull(mapped.comment.rid) };
    if (actual.pid !== wanted.pid || actual.rid !== wanted.rid) {
      await updateParents(connection, database, mapped.walineId, wanted);
      updatedLegacyCoids.add(expected.legacyCoid);
    }
  }

  const absent = state
    .filter((item) => !sourceCoids.has(item.legacyCoid))
    .map((item) => ({ legacyCoid: item.legacyCoid, walineId: item.walineId }));
  let sweep = { deleted: 0, deletedLegacyCoids: [] };
  if (absent.length && applySweep) sweep = await sweepAbsent(connection, database, absent);

  return {
    inserted: insertedLegacyCoids.length,
    updated: updatedLegacyCoids.size,
    deleted: sweep.deleted,
    insertedLegacyCoids: insertedLegacyCoids.sort((a, b) => a - b),
    updatedLegacyCoids: [...updatedLegacyCoids].sort((a, b) => a - b),
    deletedLegacyCoids: sweep.deletedLegacyCoids,
    pendingAbsentLegacyCoids: applySweep ? [] : absent.map((item) => item.legacyCoid).sort((a, b) => a - b),
    repairedDrift: drift,
  };
}

async function reconcile(connection, database, prepared) {
  const state = await loadMappedState(connection, database);
  const byCoid = new Map(state.map((item) => [item.legacyCoid, item]));
  const walineIdByCoid = new Map(state.map((item) => [item.legacyCoid, item.walineId]));
  const expectedCoids = new Set(prepared.expected.map((item) => item.legacyCoid));
  const missingMappings = [];
  const extraMappings = [];
  const missingComments = [];
  const sourceHashMismatches = [];
  const commentMismatches = [];
  const walineIds = new Set();
  const duplicateWalineIds = [];

  for (const item of state) {
    if (walineIds.has(item.walineId)) duplicateWalineIds.push(item.walineId);
    walineIds.add(item.walineId);
    if (!expectedCoids.has(item.legacyCoid)) extraMappings.push(item.legacyCoid);
    if (!item.comment) missingComments.push(item.legacyCoid);
  }

  for (const expected of prepared.expected) {
    const actual = byCoid.get(expected.legacyCoid);
    if (!actual) {
      missingMappings.push(expected.legacyCoid);
      continue;
    }
    if (actual.sourceHash !== expected.sourceHash) sourceHashMismatches.push(expected.legacyCoid);
    if (!actual.comment) continue;
    const parentIds = expectedParentIds(expected.row, prepared.byCoid, walineIdByCoid);
    const fields = compareCommentRow(expected, actual.comment, parentIds);
    if (fields.length) commentMismatches.push({ coid: expected.legacyCoid, fields });
  }

  const db = quoteIdentifier(database);
  const [nativeRows] = await connection.execute(
    `SELECT COUNT(*) AS count
       FROM ${db}.wl_Comment c
       LEFT JOIN ${db}.astro_comment_migration_map m
         ON m.waline_id = c.id AND m.source = ?
      WHERE m.waline_id IS NULL`,
    [SOURCE_NAMESPACE],
  );

  const result = {
    sourceSelected: prepared.expected.length,
    mappings: state.length,
    mappedComments: state.filter((item) => item.comment).length,
    nativeWalineComments: Number(nativeRows[0]?.count || 0),
    missingMappings: missingMappings.sort((a, b) => a - b),
    extraMappings: extraMappings.sort((a, b) => a - b),
    missingComments: missingComments.sort((a, b) => a - b),
    duplicateWalineIds: duplicateWalineIds.sort((a, b) => a - b),
    sourceHashMismatches: sourceHashMismatches.sort((a, b) => a - b),
    commentMismatches,
  };
  result.ok = [
    result.missingMappings,
    result.extraMappings,
    result.missingComments,
    result.duplicateWalineIds,
    result.sourceHashMismatches,
    result.commentMismatches,
  ].every((items) => items.length === 0)
    && result.sourceSelected === result.mappings
    && result.mappings === result.mappedComments;
  return result;
}

function passIsNoop(pass) {
  return pass.inserted === 0 && pass.updated === 0 && pass.deleted === 0
    && pass.pendingAbsentLegacyCoids.length === 0;
}

export async function runMysqlMigration({
  connection,
  database,
  prepared,
  apply = false,
  applySweep = false,
  twice = true,
  lockTimeoutSeconds = 10,
}) {
  if (!twice) throw new Error('production MySQL migration requires twice=true');
  await validateMysqlSchema(connection, database);
  const lockName = `andy-blog:comment-migration:${database}`;
  const [lockRows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [lockName, lockTimeoutSeconds]);
  if (Number(lockRows[0]?.acquired) !== 1) {
    const error = new Error(`could not acquire MySQL migration lock: ${lockName}`);
    error.code = 'LOCK_NOT_ACQUIRED';
    throw error;
  }

  let transactionOpen = false;
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    transactionOpen = true;

    const first = await runPass(connection, database, prepared, { applySweep });
    const second = await runPass(connection, database, prepared, { applySweep });
    const reconciliation = await reconcile(connection, database, prepared);
    const secondNoop = passIsNoop(second);
    const blockers = [];
    if (!secondNoop) blockers.push('second migration pass was not a no-op');
    if (!reconciliation.ok) blockers.push('reconciliation is not zero-diff');
    if (first.pendingAbsentLegacyCoids.length) blockers.push('absent Typecho mappings require explicit --apply-sweep');

    const ok = blockers.length === 0;
    let committed = false;
    if (apply && ok) {
      await connection.commit();
      committed = true;
    } else {
      await connection.rollback();
    }
    transactionOpen = false;
    return {
      ok,
      mode: apply ? 'apply' : 'dry-run',
      committed,
      applySweep,
      sourceCounts: summarizePreparedSource(prepared),
      first,
      second,
      secondNoop,
      reconciliation,
      blockers,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original migration error.
      }
    }
    throw error;
  } finally {
    try {
      await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    } catch {
      // Connection close also releases the named lock; do not mask the result.
    }
  }
}
