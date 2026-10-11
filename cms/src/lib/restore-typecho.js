import schema from '../../../scripts/migration-package-schema.json' with { type: 'json' };
import { CMS_SCHEMA_SQL } from './schema.js';

const RESTORED_DATABASE = 'typecho_restore';

const TYPECHO_CONTENTS = `CREATE TABLE IF NOT EXISTS typecho_contents (
  cid INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NULL,
  slug VARCHAR(200) NULL,
  created INT UNSIGNED NOT NULL,
  modified INT UNSIGNED NOT NULL,
  text LONGTEXT NULL,
  \`order\` INT UNSIGNED NOT NULL DEFAULT 0,
  authorId INT UNSIGNED NOT NULL DEFAULT 0,
  template VARCHAR(32) NULL,
  type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  password VARCHAR(32) NULL,
  commentsNum INT UNSIGNED NOT NULL DEFAULT 0,
  allowComment CHAR(1) NOT NULL DEFAULT '1',
  allowPing CHAR(1) NOT NULL DEFAULT '0',
  allowFeed CHAR(1) NOT NULL DEFAULT '1',
  parent INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

function quote(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`bad column ${name}`);
  return name === 'order' ? '`order`' : name;
}

export async function assertRestoreDatabase(db) {
  const [rows] = await db.query('SELECT DATABASE() AS name');
  if (rows[0]?.name !== RESTORED_DATABASE) {
    throw new Error(`restore refuses database ${rows[0]?.name || ''}`);
  }
}

export async function ensureTypechoSchema(db) {
  await assertRestoreDatabase(db);
  await db.query(TYPECHO_CONTENTS);
  for (const statement of CMS_SCHEMA_SQL) {
    if (!/CREATE TABLE IF NOT EXISTS cms_(metas|relationships|fields|i18n_)/.test(statement)) continue;
    await db.query(statement.replaceAll('cms_', 'typecho_'));
  }
}

function packageRows(exported, table) {
  return (exported[table] || []).map((row) => {
    const copy = {};
    for (const column of schema.tables[table].columns) copy[column] = row[column] === undefined ? null : row[column];
    return copy;
  });
}

function maxId(rows, key) {
  return rows.reduce((max, row) => Math.max(max, Number(row[key]) || 0), 0);
}

export function planRestore(exported) {
  const tables = {};
  for (const name of Object.keys(schema.tables)) tables[name] = packageRows(exported, name);
  return {
    tables,
    omitted: ['cms_content_revisions', 'cms_change_log', 'cms_import_runs', 'cms_publish_outbox', 'text_sha256'],
    autoIncrement: {
      cid: maxId(tables.contents, 'cid') + 1,
      mid: maxId(tables.metas, 'mid') + 1,
      version_id: maxId(tables.i18n_translation_version, 'version_id') + 1,
      job_id: maxId(tables.i18n_translation_job, 'job_id') + 1,
      event_id: maxId(tables.i18n_publish_outbox, 'event_id') + 1,
    },
  };
}

async function deleteMissing(db, table, keys, rows) {
  const [existing] = await db.query(`SELECT ${keys.map(quote).join(',')} FROM ${table}`);
  const keep = new Set(rows.map((row) => keys.map((key) => String(row[key])).join(':')));
  for (const row of existing) {
    const id = keys.map((key) => String(row[key])).join(':');
    if (keep.has(id)) continue;
    const where = keys.map((key) => `${quote(key)} = ?`).join(' AND ');
    await db.query(`DELETE FROM ${table} WHERE ${where}`, keys.map((key) => row[key]));
  }
}

async function upsert(db, table, columns, keys, rows) {
  if (!rows.length) return;
  const assignments = columns.filter((column) => !keys.includes(column));
  const update = (assignments.length ? assignments : [keys[0]])
    .map((column) => `${quote(column)} = new.${quote(column)}`)
    .join(', ');
  const sql = `INSERT INTO ${table} (${columns.map(quote).join(',')})
    VALUES (${columns.map(() => '?').join(',')}) AS new
    ON DUPLICATE KEY UPDATE ${update}`;
  for (const row of rows) {
    await db.query(sql, columns.map((column) => row[column]));
  }
}

const TYPECHO_TABLE = {
  contents: 'typecho_contents',
  metas: 'typecho_metas',
  relationships: 'typecho_relationships',
  fields: 'typecho_fields',
  i18n_source_state: 'typecho_i18n_source_state',
  i18n_translation_head: 'typecho_i18n_translation_head',
  i18n_translation_version: 'typecho_i18n_translation_version',
  i18n_translation_job: 'typecho_i18n_translation_job',
  i18n_publish_outbox: 'typecho_i18n_publish_outbox',
  i18n_publication_ledger: 'typecho_i18n_publication_ledger',
  i18n_migrations: 'typecho_i18n_migrations',
};

export async function applyRestore(db, exported) {
  await assertRestoreDatabase(db);
  await ensureTypechoSchema(db);
  const plan = planRestore(exported);
  await db.beginTransaction();
  try {
    for (const [name, table] of Object.entries(TYPECHO_TABLE)) {
      const spec = schema.tables[name];
      await deleteMissing(db, table, spec.primaryKey, plan.tables[name]);
      await upsert(db, table, spec.columns, spec.primaryKey, plan.tables[name]);
    }
    await db.commit();
    await db.query('ALTER TABLE typecho_contents AUTO_INCREMENT = ?', [plan.autoIncrement.cid]);
    await db.query('ALTER TABLE typecho_metas AUTO_INCREMENT = ?', [plan.autoIncrement.mid]);
    await db.query('ALTER TABLE typecho_i18n_translation_version AUTO_INCREMENT = ?', [plan.autoIncrement.version_id]);
    await db.query('ALTER TABLE typecho_i18n_translation_job AUTO_INCREMENT = ?', [plan.autoIncrement.job_id]);
    await db.query('ALTER TABLE typecho_i18n_publish_outbox AUTO_INCREMENT = ?', [plan.autoIncrement.event_id]);
    return plan;
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  }
}
