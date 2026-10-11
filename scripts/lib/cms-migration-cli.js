import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import schema from '../migration-package-schema.json' with { type: 'json' };
import { assertLocalDbHost, ensureCmsSchema } from '../../cms/src/lib/content-store.js';
import { jsonSafeInteger, safeIntegerTypeCast } from './json-safe.js';
import { applyBootstrap, applyMirror } from '../../cms/src/lib/import-apply.js';
import { rebuildBody } from '../../cms/src/lib/publish-outbox.js';
import { applyRestore, assertRestoreDatabase } from '../../cms/src/lib/restore-typecho.js';
import {
  refreshMigrationChecksums,
  validateMigrationPackage,
  writeMigrationPackage,
} from './cms-contract.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../docs/cms/fixtures');

const CMS_TABLE = {
  contents: 'cms_contents',
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

const CMS_ONLY = [
  ['content-revisions.json', 'SELECT * FROM cms_content_revisions ORDER BY revision_id'],
  ['change-log.json', 'SELECT * FROM cms_change_log ORDER BY log_id'],
  ['import-runs.json', 'SELECT * FROM cms_import_runs ORDER BY run_id'],
  ['publish-outbox.json', 'SELECT * FROM cms_publish_outbox ORDER BY event_id'],
  ['media.json', 'SELECT * FROM cms_media ORDER BY media_id'],
  ['audit-log.json', 'SELECT * FROM cms_audit_log ORDER BY audit_id'],
];

const UNFINISHED = new Set(['pending', 'sending', 'failed']);

export class MigrationExit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function exitCode(error) {
  if (error instanceof MigrationExit) return error.code;
  if (String(error?.message || '').includes('refuses')) return 65;
  return 1;
}

const CMS_BOOKKEEPING = {
  contents: new Set(['revision', 'text_sha256']),
};

async function collectExtraColumns(db, prefix) {
  const extraColumns = {};
  const rows = {};
  for (const [name, spec] of Object.entries(schema.tables)) {
    const table = `${prefix}${name}`;
    const [found] = await db.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [table],
    );
    const known = new Set(spec.columns);
    const ignore = prefix === 'cms_' ? (CMS_BOOKKEEPING[name] || new Set()) : new Set();
    const extra = found.map((row) => row.name).filter((column) => !known.has(column) && !ignore.has(column));
    if (!extra.length) continue;
    extraColumns[name] = extra;
    const select = [...spec.primaryKey, ...extra].map(quote).join(', ');
    const order = spec.primaryKey.map(quote).join(', ');
    const [data] = await db.query(`SELECT ${select} FROM ${table} ORDER BY ${order}`);
    rows[name] = data.map(rowCells);
  }
  return { extraColumns, rows };
}

function unmappedExtraColumns(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return Object.entries(manifest.extraColumns || {}).flatMap(([table, columns]) => (
    Array.isArray(columns) ? columns.map((column) => `${table}.${column}`) : []
  ));
}

function assertMappedExtras(dir) {
  const blocked = unmappedExtraColumns(dir);
  if (blocked.length) throw new MigrationExit(1, `unmapped extra columns: ${blocked.join(',')}`);
}

function quote(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new MigrationExit(1, `bad column ${name}`);
  return name === 'order' ? '`order`' : name;
}

function cell(value) {
  if (typeof value === 'bigint') return jsonSafeInteger(value);
  if (Buffer.isBuffer(value)) return { encoding: 'base64', data: value.toString('base64') };
  return value;
}

function rowCells(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)]));
}

export function parseMigrationArgs(argv) {
  const execute = argv.includes('--execute');
  let packageDir = '';
  let mode = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--package') packageDir = argv[i + 1] || '';
    if (argv[i] === '--mode') mode = argv[i + 1] || '';
  }
  return { execute, dryRun: !execute, packageDir, mode };
}

function assertPackagePath(dir) {
  if (!dir || dir.includes('..') || !path.isAbsolute(dir)) {
    throw new MigrationExit(64, 'package dir must be an absolute path without ..');
  }
}

export function assertOutputPackageDir(dir) {
  assertPackagePath(dir);
  const resolved = path.resolve(dir);
  if (resolved === FIXTURES || resolved.startsWith(FIXTURES + path.sep)) {
    throw new MigrationExit(65, 'refusing to write over docs/cms/fixtures');
  }
}

export function assertCmsDatabaseName(name) {
  if (!/^cms($|_)/.test(name || '')) {
    throw new MigrationExit(65, 'import execute refuses a database outside local cms names');
  }
}

export function normalizeLeasedJobs(jobs) {
  return jobs.map((job) => (
    job.status === 'leased'
      ? { ...job, status: 'queued', lease_owner: null, lease_until: null }
      : { ...job }
  ));
}

export function rebuildPlan(events) {
  const retainedPublishEvents = events.filter((row) => UNFINISHED.has(row.status)).length;
  return {
    controlledRebuild: retainedPublishEvents > 0 ? 1 : 0,
    retainedPublishEvents,
  };
}

function publishEventKey(row) {
  if (row.event_id != null && row.event_id !== '') return row.event_id;
  if (row.idem_key) return row.idem_key;
  throw new MigrationExit(1, 'unfinished publish event has no id');
}

function sameEventIdList(left, right) {
  return left.length === right.length && left.every((id, index) => String(id) === String(right[index]));
}

export function owedRebuild(events) {
  const unfinished = (events || []).filter((row) => UNFINISHED.has(row.status));
  if (!unfinished.length) return null;
  const eventIds = unfinished.map(publishEventKey).sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const leftIsCount = Number.isSafeInteger(leftNumber) && String(leftNumber) === String(left);
    const rightIsCount = Number.isSafeInteger(rightNumber) && String(rightNumber) === String(right);
    if (leftIsCount && rightIsCount) return leftNumber - rightNumber;
    return String(left).localeCompare(String(right));
  });
  return { requests: 1, eventIds, evidence: null };
}

export function publishRebuildPlan(events) {
  return { ...rebuildPlan(events), owedRebuild: owedRebuild(events) };
}

export function releaseRetainedPublish(events, evidence) {
  const owed = owedRebuild(events);
  if (!owed) return { released: false, events };
  const ids = Array.isArray(evidence?.eventIds) ? evidence.eventIds : null;
  const accepted = evidence?.status === 'accepted' && evidence.requests === 1 && ids && sameEventIdList(ids, owed.eventIds);
  if (!accepted) throw new MigrationExit(65, 'unfinished publish events stay until one accepted rebuild');
  return { released: true, events };
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertLoopbackRebuildUrl(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new MigrationExit(65, 'owed rebuild endpoint is not a URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new MigrationExit(65, 'owed rebuild refuses a non-local endpoint');
  }
  return url;
}

export async function postOwedRebuild({ owed, endpoint, secret, now, nonce, fetchImpl = fetch }) {
  if (!owed) return { sent: false, requests: 0, evidence: null };
  if (owed.requests !== 1 || !Array.isArray(owed.eventIds) || owed.eventIds.length === 0) {
    throw new MigrationExit(65, 'owed rebuild is not one request');
  }
  const url = assertLoopbackRebuildUrl(endpoint);
  if (typeof secret !== 'string' || secret.length === 0) throw new MigrationExit(64, 'webhook secret is empty');
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new MigrationExit(64, 'nonce must be 32 hex characters');
  const body = JSON.stringify(rebuildBody({ now, nonce }));
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signature },
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 202) return { sent: true, requests: 1, httpStatus: response.status, evidence: null };
  return {
    sent: true,
    requests: 1,
    httpStatus: 202,
    evidence: { status: 'accepted', requests: 1, eventIds: owed.eventIds },
  };
}

export function readOwedRebuild(dir) {
  const file = path.join(dir, 'cms-only', 'publish-outbox.json');
  if (!fs.existsSync(file)) return null;
  const events = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(events)) throw new MigrationExit(1, 'publish-outbox.json is not a list');
  return owedRebuild(events);
}

export function loadPackageTables(dir) {
  assertPackagePath(dir);
  const errors = validateMigrationPackage(dir);
  if (errors.length) throw new MigrationExit(1, errors.join('\n'));
  const tables = {};
  for (const [name, spec] of Object.entries(schema.tables)) {
    tables[name] = JSON.parse(fs.readFileSync(path.join(dir, spec.file), 'utf8'));
  }
  return tables;
}

export function readRebuildPlan(dir) {
  const file = path.join(dir, 'cms-only', 'rebuild-plan.json');
  if (!fs.existsSync(file)) return { controlledRebuild: 0, retainedPublishEvents: 0 };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function attachmentUploads(contents, uploadRoot) {
  const attachments = contents.filter((row) => row.type === 'attachment');
  const uploads = [];
  for (const row of attachments) {
    let parsed = null;
    try {
      parsed = JSON.parse(row.text);
    } catch {
      parsed = null;
    }
    const rel = parsed && typeof parsed.path === 'string' ? parsed.path : '';
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
      throw new MigrationExit(65, `attachment cid ${row.cid} has no safe upload path`);
    }
    if (!uploadRoot) throw new MigrationExit(65, 'CMS_UPLOAD_ROOT is required when attachments exist');
    const root = path.resolve(uploadRoot);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new MigrationExit(65, `attachment cid ${row.cid} escapes the upload root`);
    }
    if (!fs.existsSync(abs)) throw new MigrationExit(65, `missing upload ${rel}`);
    uploads.push({ path: rel, bytes: fs.readFileSync(abs) });
  }
  return { attachments, uploads };
}

async function readCmsSnapshot(db) {
  const [staging] = await db.query(
    `SELECT run_id FROM cms_import_runs WHERE status = 'staging' LIMIT 1`,
  );
  if (staging.length) throw new MigrationExit(65, 'import is incomplete');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  try {
    const tables = {};
    for (const [name, spec] of Object.entries(schema.tables)) {
      const columns = spec.columns.map(quote).join(', ');
      const order = spec.primaryKey.map(quote).join(', ');
      const [rows] = await db.query(`SELECT ${columns} FROM ${CMS_TABLE[name]} ORDER BY ${order}`);
      tables[name] = rows.map(rowCells);
    }
    const only = {};
    for (const [file, sql] of CMS_ONLY) {
      const [rows] = await db.query(sql);
      only[file] = rows.map(rowCells);
    }
    const extras = await collectExtraColumns(db, 'cms_');
    await db.query('COMMIT');
    return { tables, only, extras };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

export async function exportCmsPackage(db, dir, uploadRoot) {
  assertOutputPackageDir(dir);
  const { tables, only, extras } = await readCmsSnapshot(db);
  const leasedNormalized = tables.i18n_translation_job.filter((row) => row.status === 'leased').length;
  tables.i18n_translation_job = normalizeLeasedJobs(tables.i18n_translation_job);
  const { attachments, uploads } = attachmentUploads(tables.contents, uploadRoot);
  const plan = publishRebuildPlan(only['publish-outbox.json']);
  writeMigrationPackage(dir, tables, {
    source: 'cms-local-export',
    attachments,
    uploads,
    extraColumns: extras.extraColumns,
    extraColumnRows: extras.rows,
  });
  const onlyDir = path.join(dir, 'cms-only');
  fs.mkdirSync(onlyDir, { recursive: true });
  for (const [file, rows] of Object.entries(only)) {
    fs.writeFileSync(path.join(onlyDir, file), `${JSON.stringify(rows)}\n`);
  }
  fs.writeFileSync(path.join(onlyDir, 'rebuild-plan.json'), `${JSON.stringify(plan)}\n`);
  refreshMigrationChecksums(dir);
  const errors = validateMigrationPackage(dir);
  if (errors.length) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new MigrationExit(1, errors.join('\n'));
  }
  return { leasedNormalized, ...plan };
}

export function assertTypechoRestoreName(name) {
  if (name !== 'typecho_restore') {
    throw new MigrationExit(65, 'typecho export refuses a database other than typecho_restore');
  }
}

export async function exportTypechoPackage(db, dir, uploadRoot) {
  assertOutputPackageDir(dir);
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  let tables;
  let extras = { extraColumns: {}, rows: {} };
  try {
    tables = {};
    for (const [name, spec] of Object.entries(schema.tables)) {
      const columns = spec.columns.map(quote).join(', ');
      const order = spec.primaryKey.map(quote).join(', ');
      const [rows] = await db.query(
        `SELECT ${columns} FROM typecho_${name} ORDER BY ${order}`,
      );
      tables[name] = rows.map(rowCells);
    }
    extras = await collectExtraColumns(db, 'typecho_');
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
  const leasedNormalized = tables.i18n_translation_job.filter((row) => row.status === 'leased').length;
  tables.i18n_translation_job = normalizeLeasedJobs(tables.i18n_translation_job);
  const { attachments, uploads } = attachmentUploads(tables.contents, uploadRoot);
  const only = {
    'content-revisions.json': [],
    'change-log.json': [],
    'import-runs.json': [],
    'publish-outbox.json': [],
    'media.json': [],
    'audit-log.json': [],
  };
  const plan = publishRebuildPlan(only['publish-outbox.json']);
  writeMigrationPackage(dir, tables, {
    source: 'typecho-local-export',
    attachments,
    uploads,
    extraColumns: extras.extraColumns,
    extraColumnRows: extras.rows,
  });
  const onlyDir = path.join(dir, 'cms-only');
  fs.mkdirSync(onlyDir, { recursive: true });
  for (const [file, rows] of Object.entries(only)) {
    fs.writeFileSync(path.join(onlyDir, file), `${JSON.stringify(rows)}\n`);
  }
  fs.writeFileSync(path.join(onlyDir, 'rebuild-plan.json'), `${JSON.stringify(plan)}\n`);
  refreshMigrationChecksums(dir);
  const errors = validateMigrationPackage(dir);
  if (errors.length) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new MigrationExit(1, errors.join('\n'));
  }
  return { leasedNormalized, ...plan };
}

function keyOf(row, keys) {
  return keys.map((key) => String(row[key])).join(':');
}

function sameCell(column, left, right) {
  if (column === 'allowComment' || column === 'allowPing' || column === 'allowFeed') {
    return String(left ?? '') === String(right ?? '');
  }
  return Object.is(left, right);
}

export async function diffAgainstTarget(db, tables) {
  const insert = {};
  const update = {};
  const remove = {};
  for (const [name, spec] of Object.entries(schema.tables)) {
    const table = `typecho_${name}`;
    const [found] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    );
    const current = Number(found[0].n)
      ? (await db.query(`SELECT ${spec.columns.map(quote).join(', ')} FROM ${table}`))[0].map(rowCells)
      : [];
    const incoming = new Map(tables[name].map((row) => [keyOf(row, spec.primaryKey), row]));
    const present = new Map(current.map((row) => [keyOf(row, spec.primaryKey), row]));
    insert[name] = [...incoming.keys()].filter((key) => !present.has(key));
    remove[name] = [...present.keys()].filter((key) => !incoming.has(key));
    update[name] = [];
    for (const [key, row] of incoming) {
      const old = present.get(key);
      if (!old) continue;
      const changed = spec.columns.some((column) => !sameCell(column, old[column], row[column]));
      if (changed) update[name].push(key);
    }
  }
  return { insert, update, delete: remove };
}

export async function openLocalDb() {
  const host = process.env.DB_HOST || '';
  assertLocalDbHost(host);
  if (!process.env.DB_NAME) throw new MigrationExit(64, 'DB_NAME is required');
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    connectTimeout: 2000,
    typeCast: safeIntegerTypeCast,
  });
}

export async function openShadowDb() {
  const host = process.env.CMS_DB_HOST || '';
  assertLocalDbHost(host);
  assertCmsDatabaseName(process.env.CMS_DB_NAME);
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({
    host,
    port: Number(process.env.CMS_DB_PORT || 3307),
    user: process.env.CMS_DB_USER || 'root',
    password: process.env.CMS_DB_PASSWORD ?? '',
    database: process.env.CMS_DB_NAME,
    charset: 'utf8mb4',
    connectTimeout: 2000,
    typeCast: safeIntegerTypeCast,
  });
}

export async function runImport(argv) {
  const args = parseMigrationArgs(argv);
  if (!args.packageDir || (args.mode !== 'bootstrap' && args.mode !== 'mirror')) {
    throw new MigrationExit(64, 'usage: import-typecho-to-cms.js --package dir --mode bootstrap|mirror [--execute]');
  }
  const tables = loadPackageTables(args.packageDir);
  assertMappedExtras(args.packageDir);
  if (args.dryRun) {
    const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
    return { dryRun: true, mode: args.mode, counts };
  }
  assertCmsDatabaseName(process.env.DB_NAME);
  const db = await openLocalDb();
  try {
    await ensureCmsSchema(db);
    const options = { packageId: path.basename(args.packageDir), source: 'import-typecho-to-cms' };
    const applied = args.mode === 'bootstrap'
      ? await applyBootstrap(db, tables, options)
      : await applyMirror(db, tables, options);
    return { dryRun: false, mode: args.mode, runId: applied.runId };
  } finally {
    await db.end();
  }
}

export async function runRestore(argv) {
  const args = parseMigrationArgs(argv);
  if (!args.packageDir) {
    throw new MigrationExit(64, 'usage: restore-cms-to-typecho.js --package dir [--execute]');
  }
  const tables = loadPackageTables(args.packageDir);
  assertMappedExtras(args.packageDir);
  const plan = readRebuildPlan(args.packageDir);
  const owed = readOwedRebuild(args.packageDir);
  const db = await openLocalDb();
  try {
    await assertRestoreDatabase(db);
    const diff = await diffAgainstTarget(db, tables);
    if (args.dryRun) return { dryRun: true, database: process.env.DB_NAME, ...plan, owedRebuild: owed, ...diff };
    const restored = await applyRestore(db, tables);
    return {
      dryRun: false,
      database: process.env.DB_NAME,
      applied: true,
      ...plan,
      owedRebuild: owed,
      autoIncrement: restored.autoIncrement,
      ...diff,
    };
  } finally {
    await db.end();
  }
}
