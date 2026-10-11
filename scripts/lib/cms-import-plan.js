import schema from '../migration-package-schema.json' with { type: 'json' };

const RECOGNIZED = new Set(schema.recognizedContentTypes);

function columnSet(table) {
  return new Set(schema.tables[table].columns);
}

function assertColumns(table, rows) {
  const allowed = columnSet(table);
  for (const row of rows) {
    const extra = Object.keys(row).filter((key) => !allowed.has(key));
    if (extra.length) {
      throw new Error(`unmapped ${table} columns: ${extra.join(',')}`);
    }
  }
}

function maxId(rows, key) {
  return rows.reduce((max, row) => Math.max(max, Number(row[key]) || 0), 0);
}

/**
 * Copy a private package into CMS table rows without rewriting text.
 * Translation outbox rows stay on the i18n table. The generic queue starts empty.
 */
export function planBootstrap(tables) {
  const contents = tables.contents || [];
  const i18nTables = [
    'i18n_source_state',
    'i18n_translation_head',
    'i18n_translation_version',
    'i18n_translation_job',
    'i18n_publish_outbox',
    'i18n_publication_ledger',
    'i18n_migrations',
  ];
  assertColumns('contents', contents);
  assertColumns('metas', tables.metas || []);
  assertColumns('relationships', tables.relationships || []);
  assertColumns('fields', tables.fields || []);
  for (const name of i18nTables) assertColumns(name, tables[name] || []);
  const unknown = contents.filter((row) => !RECOGNIZED.has(row.type));
  if (unknown.length) {
    throw new Error(`unmapped content type: ${unknown.map((row) => `${row.cid}:${row.type}`).join(',')}`);
  }
  return {
    contents: contents.map((row) => ({ ...row })),
    metas: (tables.metas || []).map((row) => ({ ...row })),
    relationships: (tables.relationships || []).map((row) => ({ ...row })),
    fields: (tables.fields || []).map((row) => ({ ...row })),
    i18n_source_state: (tables.i18n_source_state || []).map((row) => ({ ...row })),
    i18n_translation_head: (tables.i18n_translation_head || []).map((row) => ({ ...row })),
    i18n_translation_version: (tables.i18n_translation_version || []).map((row) => ({ ...row })),
    i18n_translation_job: (tables.i18n_translation_job || []).map((row) => ({ ...row })),
    i18n_publish_outbox: (tables.i18n_publish_outbox || []).map((row) => ({ ...row })),
    i18n_publication_ledger: (tables.i18n_publication_ledger || []).map((row) => ({ ...row })),
    i18n_migrations: (tables.i18n_migrations || []).map((row) => ({ ...row })),
    cms_publish_outbox: [],
    autoIncrement: {
      cid: maxId(contents, 'cid') + 1,
      mid: maxId(tables.metas || [], 'mid') + 1,
      version_id: maxId(tables.i18n_translation_version || [], 'version_id') + 1,
    },
  };
}

function rowId(row, keys) {
  return keys.map((key) => String(row[key])).join(':');
}

/** Compare package columns only. CMS bookkeeping columns are not part of the package. */
export function diffPackageTables(source, exported) {
  const diffs = [];
  for (const [name, spec] of Object.entries(schema.tables)) {
    const left = source[name] || [];
    const right = exported[name] || [];
    const index = new Map(right.map((row) => [rowId(row, spec.primaryKey), row]));
    const seen = new Set();
    for (const row of left) {
      const id = rowId(row, spec.primaryKey);
      seen.add(id);
      const other = index.get(id);
      if (!other) {
        diffs.push({ table: name, id, kind: 'missing' });
        continue;
      }
      for (const column of spec.columns) {
        const fromPackage = row[column] === undefined ? null : row[column];
        const fromDb = other[column] === undefined ? null : other[column];
        if (Object.is(fromPackage, fromDb)) continue;
        if (fromPackage == null && fromDb == null) continue;
        diffs.push({ table: name, id, column, source: fromPackage, exported: fromDb });
      }
    }
    for (const row of right) {
      const id = rowId(row, spec.primaryKey);
      if (!seen.has(id)) diffs.push({ table: name, id, kind: 'extra' });
    }
  }
  return diffs;
}
