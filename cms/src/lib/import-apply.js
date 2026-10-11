import schema from '../../../scripts/migration-package-schema.json' with { type: 'json' };
import { planBootstrap } from '../../../scripts/lib/cms-import-plan.js';
import { jsonSafeInteger } from '../../../scripts/lib/json-safe.js';
import { sha256Text } from './content-store.js';

const COPIED = {
  metas: 'cms_metas',
  relationships: 'cms_relationships',
  fields: 'cms_fields',
  i18n_source_state: 'cms_i18n_source_state',
  i18n_translation_head: 'cms_i18n_translation_head',
  i18n_translation_version: 'cms_i18n_translation_version',
  i18n_translation_job: 'cms_i18n_translation_job',
  i18n_publish_outbox: 'cms_i18n_publish_outbox',
  i18n_publication_ledger: 'cms_i18n_publication_ledger',
  i18n_migrations: 'cms_i18n_migrations',
};

function quote(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`bad column ${name}`);
  return name === 'order' ? '`order`' : name;
}

async function insertRows(db, table, columns, rows) {
  if (!rows.length) return;
  const sql = `INSERT INTO ${table} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
  for (const row of rows) {
    await db.query(sql, columns.map((column) => (row[column] === undefined ? null : row[column])));
  }
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

async function upsertRows(db, table, columns, keys, rows) {
  if (!rows.length) return;
  const assignments = columns
    .filter((column) => !keys.includes(column))
    .map((column) => `${quote(column)} = new.${quote(column)}`);
  const update = assignments.length ? assignments.join(', ') : `${quote(keys[0])} = new.${quote(keys[0])}`;
  const sql = `INSERT INTO ${table} (${columns.map(quote).join(',')})
    VALUES (${columns.map(() => '?').join(',')}) AS new
    ON DUPLICATE KEY UPDATE ${update}`;
  for (const row of rows) {
    await db.query(sql, columns.map((column) => (row[column] === undefined ? null : row[column])));
  }
}

async function upsertContents(db, plan) {
  const revisions = new Map(plan.i18n_source_state.map((row) => [Number(row.cid), Number(row.source_revision)]));
  for (const row of plan.contents) {
    const text = row.text == null ? null : String(row.text);
    const values = [
      row.cid, row.title, row.slug, row.created, row.modified, text, row.order, row.authorId,
      row.template, row.type, row.status, row.password, row.commentsNum, row.allowComment,
      row.allowPing, row.allowFeed, row.parent, revisions.get(Number(row.cid)) || 1,
      sha256Text(text == null ? '' : text),
    ];
    await db.query(
      `INSERT INTO cms_contents
        (cid, title, slug, created, modified, text, \`order\`, authorId, template, type, status,
         password, commentsNum, allowComment, allowPing, allowFeed, parent, revision, text_sha256)
       VALUES (${values.map(() => '?').join(',')}) AS new
       ON DUPLICATE KEY UPDATE
         title = new.title, slug = new.slug, created = new.created, modified = new.modified,
         text = new.text, \`order\` = new.\`order\`, authorId = new.authorId, template = new.template,
         type = new.type, status = new.status, password = new.password, commentsNum = new.commentsNum,
         allowComment = new.allowComment, allowPing = new.allowPing, allowFeed = new.allowFeed,
         parent = new.parent, revision = new.revision, text_sha256 = new.text_sha256`,
      values,
    );
  }
}

async function assertNoStaging(db) {
  const [incomplete] = await db.query(`SELECT run_id FROM cms_import_runs WHERE status = 'staging' LIMIT 1`);
  if (incomplete.length) throw new Error('import is incomplete');
}

async function openStagingRun(db, { packageId, mode, source, counts, now }) {
  const [run] = await db.query(
    `INSERT INTO cms_import_runs (package_id, mode, status, source, row_counts, started_at)
     VALUES (?, ?, 'staging', ?, ?, ?)`,
    [packageId, mode, source, JSON.stringify(counts), now],
  );
  return Number(run.insertId);
}

async function failStagingRun(db, runId, now) {
  await db.query(
    `UPDATE cms_import_runs SET status = 'failed', finished_at = ? WHERE run_id = ? AND status = 'staging'`,
    [now, runId],
  );
}

export async function applyBootstrap(db, tables, { packageId, source }) {
  const plan = planBootstrap(tables);
  const [writes] = await db.query('SELECT COUNT(*) AS n FROM cms_change_log');
  if (Number(writes[0].n) > 0) throw new Error('bootstrap refuses a database with CMS writes');
  const [existing] = await db.query('SELECT COUNT(*) AS n FROM cms_contents');
  if (Number(existing[0].n) > 0) throw new Error('bootstrap refuses a database that already has contents');
  await assertNoStaging(db);
  const revisions = new Map(plan.i18n_source_state.map((row) => [Number(row.cid), Number(row.source_revision)]));
  await db.query('ALTER TABLE cms_contents AUTO_INCREMENT = ?', [plan.autoIncrement.cid]);
  await db.query('ALTER TABLE cms_metas AUTO_INCREMENT = ?', [plan.autoIncrement.mid]);
  await db.query('ALTER TABLE cms_i18n_translation_version AUTO_INCREMENT = ?', [plan.autoIncrement.version_id]);
  const now = Math.floor(Date.now() / 1000);
  const counts = Object.fromEntries(Object.keys(COPIED).map((name) => [name, plan[name].length]));
  counts.contents = plan.contents.length;
  const runId = await openStagingRun(db, { packageId, mode: 'bootstrap', source, counts, now });
  await db.beginTransaction();
  try {
    for (const row of plan.contents) {
      const text = row.text == null ? null : String(row.text);
      await db.query(
        `INSERT INTO cms_contents
          (cid, title, slug, created, modified, text, \`order\`, authorId, template, type, status,
           password, commentsNum, allowComment, allowPing, allowFeed, parent, revision, text_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.cid, row.title, row.slug, row.created, row.modified, text, row.order, row.authorId,
          row.template, row.type, row.status, row.password, row.commentsNum, row.allowComment,
          row.allowPing, row.allowFeed, row.parent, revisions.get(Number(row.cid)) || 1,
          sha256Text(text == null ? '' : text),
        ],
      );
    }
    for (const [name, table] of Object.entries(COPIED)) {
      await insertRows(db, table, schema.tables[name].columns, plan[name]);
    }
    await db.query(
      `UPDATE cms_import_runs SET status = 'complete', finished_at = ? WHERE run_id = ?`,
      [now, runId],
    );
    await db.commit();
    return { runId, autoIncrement: plan.autoIncrement };
  } catch (error) {
    try { await db.rollback(); } catch {}
    await failStagingRun(db, runId, now);
    throw error;
  }
}

export async function applyMirror(db, tables, { packageId, source }) {
  const plan = planBootstrap(tables);
  const [writes] = await db.query('SELECT COUNT(*) AS n FROM cms_change_log');
  if (Number(writes[0].n) > 0) throw new Error('mirror refuses a database with CMS writes');
  await assertNoStaging(db);
  await db.query('ALTER TABLE cms_contents AUTO_INCREMENT = ?', [plan.autoIncrement.cid]);
  await db.query('ALTER TABLE cms_metas AUTO_INCREMENT = ?', [plan.autoIncrement.mid]);
  await db.query('ALTER TABLE cms_i18n_translation_version AUTO_INCREMENT = ?', [plan.autoIncrement.version_id]);
  const now = Math.floor(Date.now() / 1000);
  const counts = Object.fromEntries(Object.keys(COPIED).map((name) => [name, plan[name].length]));
  counts.contents = plan.contents.length;
  const runId = await openStagingRun(db, { packageId, mode: 'mirror', source, counts, now });
  await db.beginTransaction();
  try {
    await deleteMissing(db, 'cms_relationships', ['cid', 'mid'], plan.relationships);
    await deleteMissing(db, 'cms_fields', ['cid', 'name'], plan.fields);
    await deleteMissing(db, 'cms_contents', ['cid'], plan.contents);
    for (const [name, table] of Object.entries(COPIED)) {
      if (name === 'metas' || name === 'relationships' || name === 'fields') continue;
      await deleteMissing(db, table, schema.tables[name].primaryKey, plan[name]);
    }
    await upsertContents(db, plan);
    await upsertRows(db, 'cms_metas', schema.tables.metas.columns, schema.tables.metas.primaryKey, plan.metas);
    await upsertRows(db, 'cms_relationships', schema.tables.relationships.columns, schema.tables.relationships.primaryKey, plan.relationships);
    await upsertRows(db, 'cms_fields', schema.tables.fields.columns, schema.tables.fields.primaryKey, plan.fields);
    for (const [name, table] of Object.entries(COPIED)) {
      if (name === 'metas' || name === 'relationships' || name === 'fields') continue;
      await upsertRows(db, table, schema.tables[name].columns, schema.tables[name].primaryKey, plan[name]);
    }
    const [run] = await db.query(
      `UPDATE cms_import_runs
       SET status = 'complete', finished_at = ?, row_counts = ?
       WHERE run_id = ? AND status = 'staging'`,
      [now, JSON.stringify(counts), runId],
    );
    if (run.affectedRows !== 1) throw new Error('import is incomplete');
    await db.commit();
    return { runId, counts };
  } catch (error) {
    try { await db.rollback(); } catch {}
    await failStagingRun(db, runId, now);
    throw error;
  }
}

function cell(value) {
  if (typeof value === 'bigint') return jsonSafeInteger(value);
  return value;
}

export async function exportPackageTables(db) {
  const [incomplete] = await db.query(`SELECT run_id FROM cms_import_runs WHERE status = 'staging' LIMIT 1`);
  if (incomplete.length) throw new Error('import is incomplete');
  const [contents] = await db.query(
    `SELECT cid, title, slug, created, modified, text, \`order\`, authorId, template, type, status,
            password, commentsNum, allowComment, allowPing, allowFeed, parent, revision, text_sha256
     FROM cms_contents ORDER BY cid`,
  );
  const exported = { contents: contents.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)]))) };
  for (const [name, table] of Object.entries(COPIED)) {
    const columns = schema.tables[name].columns.map(quote).join(',');
    const [rows] = await db.query(`SELECT ${columns} FROM ${table}`);
    exported[name] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)])));
  }
  const [outbox] = await db.query('SELECT event_id FROM cms_publish_outbox');
  exported.cms_publish_outbox = outbox;
  return exported;
}
