import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { contentDigest, sourceHash } from './i18n-store.js';

const SCRIPT_DIR = path.resolve(import.meta.dirname, '..');

export const buildSchema = JSON.parse(fsSync.readFileSync(path.join(SCRIPT_DIR, 'snapshot-schema.json'), 'utf8'));
export const migrationSchema = JSON.parse(fsSync.readFileSync(path.join(SCRIPT_DIR, 'migration-package-schema.json'), 'utf8'));

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function isSnapshotFilename(file) {
  return /^snapshot-.*\.json$/i.test(path.basename(file));
}

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isSafeInt(value) {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

const INTEGER_KEY_FIELDS = new Set(['cid', 'mid', 'version_id', 'job_id', 'event_id', 'version']);

function charOk(value) {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function pkOf(row, fields) {
  return fields.map((field) => String(row?.[field] ?? '')).join('\u0000');
}

function indexRows(rows, fields) {
  const map = new Map();
  const duplicateKeys = [];
  for (const row of rows) {
    const key = pkOf(row, fields);
    if (map.has(key)) duplicateKeys.push(key);
    else map.set(key, row);
  }
  return { map, duplicateKeys };
}

function sortedCopy(rows, fields) {
  return [...rows].sort((a, b) => {
    for (const field of fields) {
      const av = a?.[field];
      const bv = b?.[field];
      if (av === bv) continue;
      if (av === undefined || av === null) return -1;
      if (bv === undefined || bv === null) return 1;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  });
}

function orderChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function pickColumns(row, columns, dropped) {
  const out = {};
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) return { missing: column };
    out[column] = row[column];
  }
  const extra = Object.keys(row).filter((key) => !columns.includes(key));
  if (extra.length) dropped.push(extra);
  return { row: out };
}

function checkColumns(row, columns, where, errors) {
  const keys = Object.keys(row);
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) errors.push(`${where} missing ${column}`);
  }
  for (const key of keys) {
    if (!columns.includes(key)) errors.push(`${where} unexpected ${key}`);
  }
}

function checkSafeId(value, where, errors) {
  if (!isSafeInt(value)) errors.push(`${where} must be a safe integer`);
}

function checkCharPair(row, where, errors) {
  for (const column of buildSchema.charColumnsMayBeStringOrNumber) {
    if (Object.prototype.hasOwnProperty.call(row, column) && !charOk(row[column])) {
      errors.push(`${where}.${column} must be a string, finite number, or null`);
    }
  }
}

export function validateBuildSnapshot(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['snapshot must be an object'];
  }
  for (const key of buildSchema.topLevelRequired) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) errors.push(`missing ${key}`);
  }
  const allowed = new Set([...buildSchema.topLevelRequired, ...buildSchema.topLevelOptional]);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) errors.push(`unexpected top-level ${key}`);
  }
  if (data.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (!isSafeInt(data.snapshotEpoch) || String(data.snapshotEpoch).length !== 10) {
    errors.push('snapshotEpoch must be a 10-digit safe integer');
  }

  const tables = [
    ['contents', data.contents],
    ['relations', data.relations],
    ['fields', data.fields],
    ['metas', data.metas],
  ];
  const indexed = {};
  for (const [name, rows] of tables) {
    if (!Array.isArray(rows)) {
      errors.push(`${name} must be an array`);
      continue;
    }
    const spec = buildSchema[name];
    const { map, duplicateKeys } = indexRows(rows, spec.primaryKey);
    indexed[name] = map;
    for (const key of duplicateKeys) errors.push(`${name} duplicate primary key ${key}`);
    rows.forEach((row, index) => {
      const where = `${name}[${index}]`;
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`${where} must be an object`);
        return;
      }
      checkColumns(row, spec.columns, where, errors);
      checkCharPair(row, where, errors);
      for (const field of spec.primaryKey) {
        if (INTEGER_KEY_FIELDS.has(field)) checkSafeId(row[field], `${where}.${field}`, errors);
      }
    });
  }

  if (Array.isArray(data.contents)) {
    data.contents.forEach((row, index) => {
      if (!buildSchema.contentTypes.includes(row?.type)) {
        errors.push(`contents[${index}].type ${row?.type} is outside post/page/post_draft`);
      }
    });
  }
  if (Array.isArray(data.metas)) {
    data.metas.forEach((row, index) => {
      if (!buildSchema.metas.types.includes(row?.type)) {
        errors.push(`metas[${index}].type ${row?.type} is outside category/tag`);
      }
    });
  }

  if (data.i18n !== undefined) {
    if (!data.i18n || typeof data.i18n !== 'object' || Array.isArray(data.i18n)) {
      errors.push('i18n must be an object');
    } else {
      for (const key of buildSchema.i18n.required) {
        if (!Array.isArray(data.i18n[key])) errors.push(`i18n.${key} must be an array`);
      }
      for (const key of Object.keys(data.i18n)) {
        if (!buildSchema.i18n.required.includes(key)) errors.push(`i18n unexpected ${key}`);
      }
      for (const name of buildSchema.i18n.required) {
        const rows = data.i18n[name];
        if (!Array.isArray(rows)) continue;
        const spec = buildSchema.i18n[name];
        const { duplicateKeys } = indexRows(rows, spec.primaryKey);
        for (const key of duplicateKeys) errors.push(`i18n.${name} duplicate primary key ${key}`);
        rows.forEach((row, index) => {
          checkColumns(row, spec.columns, `i18n.${name}[${index}]`, errors);
          for (const field of spec.primaryKey) {
            if (INTEGER_KEY_FIELDS.has(field)) checkSafeId(row[field], `i18n.${name}[${index}].${field}`, errors);
          }
        });
      }
      const versions = new Set((data.i18n.versions || []).map((row) => row.version_id));
      const approved = new Set();
      for (const head of data.i18n.heads || []) {
        if (head.approved_version_id != null) {
          approved.add(head.approved_version_id);
          if (!versions.has(head.approved_version_id)) {
            errors.push(`head ${head.cid}/${head.locale} approved_version_id ${head.approved_version_id} is missing from versions`);
          }
        }
        if (head.draft_version_id != null && versions.has(head.draft_version_id) && head.draft_version_id !== head.approved_version_id) {
          errors.push(`head ${head.cid}/${head.locale} draft_version_id ${head.draft_version_id} must not be copied into the build snapshot`);
        }
      }
      for (const version of data.i18n.versions || []) {
        if (!approved.has(version.version_id)) {
          errors.push(`version ${version.version_id} is not an approved head pointer`);
        }
      }
    }
  }
  return errors;
}

function canonicalTable(rows, spec, report, tableName) {
  const dropped = [];
  const projected = [];
  for (const row of rows) {
    const picked = pickColumns(row, spec.columns, dropped);
    if (picked.missing) {
      report.errors.push(`${tableName} cid/key row missing ${picked.missing}`);
      return null;
    }
    projected.push(picked.row);
  }
  if (dropped.length) {
    report.droppedExtraKeys.push({ table: tableName, keys: dropped });
  }
  const ordered = sortedCopy(projected, spec.orderBy || spec.primaryKey);
  if (orderChanged(projected, ordered)) report.reorderedTables.push(tableName);
  return ordered;
}

export async function normalizeLegacySnapshot(input, output) {
  const report = {
    input: path.basename(input),
    recognizedAs: null,
    added: [],
    filteredRows: [],
    droppedExtraKeys: [],
    reorderedTables: [],
    i18n: null,
    errors: [],
    migrationComplete: false,
    migrationNote: 'Build-input upgrade only. Filtered rows stay in the original fixture. This does not certify a private migration package.',
  };
  if (!isSnapshotFilename(input)) {
    report.errors.push('input basename must match snapshot-*.json');
    return { code: 64, report };
  }
  if (path.resolve(input) === path.resolve(output)) {
    report.errors.push('output path must differ from input');
    return { code: 64, report };
  }
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(input, 'utf8'));
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : 'unreadable snapshot');
    return { code: 1, report };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    report.errors.push('snapshot must be an object');
    return { code: 1, report };
  }
  if (raw.schemaVersion == null) report.recognizedAs = 'legacy-export-without-schemaVersion';
  else if (raw.schemaVersion === 2) report.recognizedAs = 'schemaVersion-2';
  else {
    report.errors.push(`unrecognized schemaVersion ${raw.schemaVersion}`);
    return { code: 1, report };
  }
  if (!Array.isArray(raw.contents) || !Array.isArray(raw.relations) || !Array.isArray(raw.fields) || !Array.isArray(raw.metas)) {
    report.errors.push('contents, relations, fields, and metas must be arrays');
    return { code: 1, report };
  }

  const contents = [];
  for (const row of raw.contents) {
    if (!buildSchema.contentTypes.includes(row?.type)) {
      report.filteredRows.push({
        cid: row?.cid ?? null,
        type: row?.type ?? null,
        status: row?.status ?? null,
        reason: 'build snapshot keeps type post, page, and post_draft only',
      });
      continue;
    }
    contents.push(row);
  }
  const snapshot = {
    snapshotEpoch: raw.snapshotEpoch,
    schemaVersion: 2,
    contents: canonicalTable(contents, buildSchema.contents, report, 'contents'),
    relations: canonicalTable(raw.relations, buildSchema.relations, report, 'relations'),
    fields: canonicalTable(raw.fields, buildSchema.fields, report, 'fields'),
    metas: canonicalTable(raw.metas, buildSchema.metas, report, 'metas'),
  };
  if (raw.schemaVersion == null) report.added.push('schemaVersion');
  if (raw.i18n == null) {
    report.i18n = 'absent; pre-i18n sample, i18n key not invented';
  } else {
    report.i18n = 'present; approved-only membership is checked by validate-snapshot';
    snapshot.i18n = {};
    for (const name of buildSchema.i18n.required) {
      if (!Array.isArray(raw.i18n[name])) {
        report.errors.push(`i18n.${name} must be an array`);
        continue;
      }
      snapshot.i18n[name] = canonicalTable(raw.i18n[name], buildSchema.i18n[name], report, `i18n.${name}`);
    }
  }
  if (report.errors.length || Object.values(snapshot).includes(null) || (snapshot.i18n && Object.values(snapshot.i18n).includes(null))) {
    return { code: 1, report };
  }
  const errors = validateBuildSnapshot(snapshot);
  report.validationErrors = errors;
  report.counts = {
    inputContents: raw.contents.length,
    outputContents: snapshot.contents.length,
    filtered: report.filteredRows.length,
    relations: snapshot.relations.length,
    fields: snapshot.fields.length,
    metas: snapshot.metas.length,
  };
  if (errors.length) return { code: 1, report };

  const reportPath = output.replace(/\.json$/i, '') + '.upgrade-report.json';
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { code: 0, report, reportPath };
}

function readPackageJson(dir, rel) {
  const file = path.join(dir, rel);
  return JSON.parse(fsSync.readFileSync(file, 'utf8'));
}

function relativeFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fsSync.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(dir, abs).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function checksumLines(dir) {
  return relativeFiles(dir)
    .filter((rel) => rel !== 'checksums.sha256')
    .map((rel) => `${sha256(fsSync.readFileSync(path.join(dir, rel)))}  ${rel}`)
    .join('\n') + '\n';
}

function rangeOf(rows, field) {
  if (!rows.length) return null;
  const values = rows.map((row) => row[field]);
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function writeMigrationPackage(dir, tables, extras) {
  fsSync.rmSync(dir, { recursive: true, force: true });
  fsSync.mkdirSync(dir, { recursive: true });
  const hashes = {};
  for (const [name, spec] of Object.entries(migrationSchema.tables)) {
    const body = `${JSON.stringify(tables[name])}\n`;
    const rel = spec.file;
    fsSync.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fsSync.writeFileSync(path.join(dir, rel), body);
    hashes[rel] = sha256(body);
  }
  const attachmentBody = `${JSON.stringify(extras.attachments)}\n`;
  fsSync.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  fsSync.writeFileSync(path.join(dir, 'attachments', 'rows.json'), attachmentBody);
  hashes['attachments/rows.json'] = sha256(attachmentBody);
  const extraColumns = extras.extraColumns || {};
  const hasExtra = Object.values(extraColumns).some((columns) => Array.isArray(columns) && columns.length);
  if (hasExtra) {
    const extraBody = `${JSON.stringify(extras.extraColumnRows || {})}\n`;
    fsSync.writeFileSync(path.join(dir, 'extra-columns.json'), extraBody);
    hashes['extra-columns.json'] = sha256(extraBody);
  }

  fsSync.mkdirSync(path.join(dir, 'uploads', 'files'), { recursive: true });
  for (const file of extras.uploads) {
    const rel = `uploads/files/${file.path}`;
    fsSync.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fsSync.writeFileSync(path.join(dir, rel), file.bytes);
    hashes[rel] = sha256(file.bytes);
  }
  const uploadManifest = {
    files: extras.uploads.map((file) => ({
      path: file.path,
      bytes: file.bytes.length,
      sha256: sha256(file.bytes),
    })),
  };
  const uploadBody = `${JSON.stringify(uploadManifest)}\n`;
  fsSync.writeFileSync(path.join(dir, 'uploads', 'manifest.json'), uploadBody);
  hashes['uploads/manifest.json'] = sha256(uploadBody);

  const manifest = {
    migrationPackageVersion: 1,
    source: extras.source,
    tableSchema: migrationSchema.tableSchema,
    recognizedContentTypes: migrationSchema.recognizedContentTypes,
    counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    primaryKeyRanges: {
      contents: rangeOf(tables.contents, 'cid'),
      metas: rangeOf(tables.metas, 'mid'),
      versions: rangeOf(tables.i18n_translation_version, 'version_id'),
    },
    contentHashes: hashes,
    extraColumns: extras.extraColumns || {},
  };
  const manifestBody = `${JSON.stringify(manifest)}\n`;
  fsSync.writeFileSync(path.join(dir, 'manifest.json'), manifestBody);
  fsSync.writeFileSync(path.join(dir, 'checksums.sha256'), checksumLines(dir));
}

export function refreshMigrationChecksums(dir) {
  const manifest = readPackageJson(dir, 'manifest.json');
  const hashes = {};
  for (const rel of relativeFiles(dir)) {
    if (rel === 'checksums.sha256' || rel === 'manifest.json') continue;
    hashes[rel] = sha256(fsSync.readFileSync(path.join(dir, rel)));
  }
  manifest.contentHashes = hashes;
  for (const [name, spec] of Object.entries(migrationSchema.tables)) {
    const rows = readPackageJson(dir, spec.file);
    manifest.counts[name] = rows.length;
    if (name === 'contents') manifest.primaryKeyRanges.contents = rangeOf(rows, 'cid');
    if (name === 'metas') manifest.primaryKeyRanges.metas = rangeOf(rows, 'mid');
    if (name === 'i18n_translation_version') manifest.primaryKeyRanges.versions = rangeOf(rows, 'version_id');
  }
  fsSync.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  fsSync.writeFileSync(path.join(dir, 'checksums.sha256'), checksumLines(dir));
}

export function validateMigrationPackage(dir) {
  const errors = [];
  const checksumFile = path.join(dir, 'checksums.sha256');
  if (!fsSync.existsSync(checksumFile)) return ['missing checksums.sha256'];
  const expected = checksumLines(dir);
  const actual = fsSync.readFileSync(checksumFile, 'utf8');
  if (actual !== expected) errors.push('checksums.sha256 does not match payload bytes');

  let manifest;
  try {
    manifest = readPackageJson(dir, 'manifest.json');
  } catch (error) {
    return [`manifest.json unreadable: ${error instanceof Error ? error.message : error}`];
  }
  if (manifest.migrationPackageVersion !== 1) errors.push('migrationPackageVersion must be 1');
  const listedExtras = Object.entries(manifest.extraColumns || {}).filter(([, columns]) => Array.isArray(columns) && columns.length);
  if (listedExtras.length) {
    let stored = null;
    try {
      stored = readPackageJson(dir, 'extra-columns.json');
    } catch {
      errors.push('missing extra-columns.json');
    }
    if (stored) {
      for (const [table, columns] of listedExtras) {
        const rows = stored[table];
        if (!Array.isArray(rows)) {
          errors.push(`extra-columns.json missing ${table}`);
          continue;
        }
        rows.forEach((row, index) => {
          for (const column of columns) {
            if (!Object.prototype.hasOwnProperty.call(row, column)) {
              errors.push(`extra column ${table}[${index}].${column} is missing`);
            }
          }
        });
      }
    }
  }
  const tables = {};
  for (const [name, spec] of Object.entries(migrationSchema.tables)) {
    let rows;
    try {
      rows = readPackageJson(dir, spec.file);
    } catch {
      errors.push(`missing ${spec.file}`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`${spec.file} must be an array`);
      continue;
    }
    tables[name] = rows;
    if (manifest.counts?.[name] !== rows.length) errors.push(`${name} count does not match manifest`);
    const { duplicateKeys } = indexRows(rows, spec.primaryKey);
    for (const key of duplicateKeys) errors.push(`${name} duplicate primary key ${key}`);
    const recognized = new Set(manifest.recognizedContentTypes || migrationSchema.recognizedContentTypes);
    rows.forEach((row, index) => {
      const where = `${name}[${index}]`;
      checkColumns(row, spec.columns, where, errors);
      for (const field of spec.primaryKey) {
        if (INTEGER_KEY_FIELDS.has(field)) checkSafeId(row[field], `${where}.${field}`, errors);
      }
      if (name === 'contents' && !recognized.has(row.type)) {
        errors.push(`${where}.type ${row.type} is not a recognized content type`);
      }
    });
  }
  for (const [rel, hash] of Object.entries(manifest.contentHashes || {})) {
    const abs = path.join(dir, rel);
    if (!fsSync.existsSync(abs) || sha256(fsSync.readFileSync(abs)) !== hash) {
      errors.push(`${rel} hash does not match manifest`);
    }
  }
  const contentRange = manifest.primaryKeyRanges?.contents;
  if (contentRange && tables.contents?.length) {
    const ids = tables.contents.map((row) => row.cid).filter((cid) => isSafeInt(cid));
    if (ids.length && (Math.min(...ids) !== contentRange.min || Math.max(...ids) !== contentRange.max)) {
      errors.push('contents primary key range does not match manifest');
    }
  }
  if (errors.length && !tables.contents) return errors;

  const contents = new Map((tables.contents || []).map((row) => [row.cid, row]));
  const metas = new Set((tables.metas || []).map((row) => row.mid));
  const versions = new Map((tables.i18n_translation_version || []).map((row) => [row.version_id, row]));
  for (const row of tables.relationships || []) {
    if (!contents.has(row.cid)) errors.push(`relationship cid ${row.cid} missing from contents`);
    if (!metas.has(row.mid)) errors.push(`relationship mid ${row.mid} missing from metas`);
  }
  for (const row of tables.fields || []) {
    if (!contents.has(row.cid)) errors.push(`field ${row.name} cid ${row.cid} missing from contents`);
  }
  for (const row of tables.i18n_source_state || []) {
    const content = contents.get(row.cid);
    if (!content) {
      errors.push(`source_state cid ${row.cid} missing from contents`);
      continue;
    }
    const expected = sourceHash(content.title ?? '', content.text ?? '');
    if (row.source_hash !== expected) errors.push(`source_state cid ${row.cid} source_hash does not match contents text`);
  }
  for (const row of tables.i18n_translation_head || []) {
    if (!contents.has(row.cid)) errors.push(`head cid ${row.cid} missing from contents`);
    for (const field of ['draft_version_id', 'approved_version_id']) {
      if (row[field] != null && !versions.has(row[field])) {
        errors.push(`head ${row.cid}/${row.locale} ${field} ${row[field]} does not resolve`);
      }
    }
  }
  for (const row of tables.i18n_translation_version || []) {
    if (!contents.has(row.cid)) errors.push(`version ${row.version_id} cid ${row.cid} missing from contents`);
    const expected = contentDigest(row.title, row.summary ?? '', row.body);
    if (row.content_digest !== expected) errors.push(`version ${row.version_id} content_digest does not match body`);
  }
  for (const row of tables.i18n_translation_job || []) {
    if (!contents.has(row.cid)) errors.push(`job ${row.job_id} cid ${row.cid} missing from contents`);
  }
  for (const row of tables.i18n_publish_outbox || []) {
    if (!contents.has(row.cid)) errors.push(`outbox ${row.event_id} cid ${row.cid} missing from contents`);
    if (!versions.has(row.version_id)) errors.push(`outbox ${row.event_id} version_id ${row.version_id} does not resolve`);
  }
  for (const row of tables.i18n_publication_ledger || []) {
    if (!contents.has(row.cid)) errors.push(`ledger cid ${row.cid} missing from contents`);
    if (row.last_live_version_id != null && !versions.has(row.last_live_version_id)) {
      errors.push(`ledger ${row.cid}/${row.locale} last_live_version_id does not resolve`);
    }
  }

  let attachmentRows = [];
  try {
    attachmentRows = readPackageJson(dir, 'attachments/rows.json');
  } catch {
    errors.push('missing attachments/rows.json');
  }
  const fromContents = (tables.contents || []).filter((row) => row.type === 'attachment');
  const attachmentIds = new Set(attachmentRows.map((row) => row.cid));
  if (fromContents.length !== attachmentRows.length || fromContents.some((row) => !attachmentIds.has(row.cid))) {
    errors.push('attachments/rows.json does not match contents attachment rows');
  }
  for (const row of fromContents) {
    const copy = attachmentRows.find((item) => item.cid === row.cid);
    if (copy && copy.text !== row.text) errors.push(`attachment cid ${row.cid} text does not match contents`);
  }

  let uploads;
  try {
    uploads = readPackageJson(dir, 'uploads/manifest.json');
  } catch {
    errors.push('missing uploads/manifest.json');
    uploads = { files: [] };
  }
  for (const file of uploads.files || []) {
    if (typeof file.path !== 'string' || file.path.includes('..') || path.isAbsolute(file.path)) {
      errors.push(`unsafe upload path ${file.path}`);
      continue;
    }
    const abs = path.join(dir, 'uploads', 'files', file.path);
    if (!fsSync.existsSync(abs)) {
      errors.push(`missing upload blob ${file.path}`);
      continue;
    }
    const bytes = fsSync.readFileSync(abs);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      errors.push(`upload ${file.path} bytes do not match manifest`);
    }
  }
  return errors;
}

function diffRows(name, spec, aRows, bRows, diffs, duplicates) {
  const a = indexRows(aRows, spec.primaryKey);
  const b = indexRows(bRows, spec.primaryKey);
  for (const key of a.duplicateKeys) duplicates.push({ side: 'a', table: name, key });
  for (const key of b.duplicateKeys) duplicates.push({ side: 'b', table: name, key });
  for (const key of a.map.keys()) {
    if (!b.map.has(key)) diffs.push({ table: name, key, kind: 'missing', in: 'b' });
  }
  for (const key of b.map.keys()) {
    if (!a.map.has(key)) diffs.push({ table: name, key, kind: 'missing', in: 'a' });
  }
  for (const [key, aRow] of a.map) {
    const bRow = b.map.get(key);
    if (!bRow) continue;
    const fields = new Set([...Object.keys(aRow), ...Object.keys(bRow)]);
    for (const field of fields) {
      const av = aRow[field];
      const bv = bRow[field];
      if (Object.is(av, bv)) continue;
      if (JSON.stringify(av) === JSON.stringify(bv) && kindOf(av) === kindOf(bv)) continue;
      diffs.push({
        table: name,
        key,
        field,
        kind: kindOf(av) === kindOf(bv) ? 'value' : 'type',
        a: av === undefined ? null : av,
        b: bv === undefined ? null : bv,
        aType: kindOf(av),
        bType: kindOf(bv),
      });
    }
  }
}

export function compareSnapshotData(a, b) {
  const differences = [];
  const duplicateKeys = [];
  for (const field of ['snapshotEpoch', 'schemaVersion']) {
    if (!Object.is(a?.[field], b?.[field])) {
      differences.push({
        table: 'snapshot',
        key: '',
        field,
        kind: kindOf(a?.[field]) === kindOf(b?.[field]) ? 'value' : 'type',
        a: a?.[field] ?? null,
        b: b?.[field] ?? null,
        aType: kindOf(a?.[field]),
        bType: kindOf(b?.[field]),
      });
    }
  }
  for (const name of ['contents', 'relations', 'fields', 'metas']) {
    diffRows(name, buildSchema[name], a[name] || [], b[name] || [], differences, duplicateKeys);
  }
  const aI18n = a.i18n || {};
  const bI18n = b.i18n || {};
  if (Boolean(a.i18n) !== Boolean(b.i18n)) {
    differences.push({ table: 'i18n', key: '', kind: 'missing', in: a.i18n ? 'b' : 'a' });
  }
  for (const name of buildSchema.i18n.required) {
    diffRows(`i18n.${name}`, buildSchema.i18n[name], aI18n[name] || [], bI18n[name] || [], differences, duplicateKeys);
  }
  return { equal: differences.length === 0 && duplicateKeys.length === 0, duplicateKeys, differences };
}

function controlledField(table, field) {
  return migrationSchema.controlledRuntimeDifferences.find((item) => item.table === table && item.field === field);
}

function isControlled(diff) {
  const rule = controlledField(diff.table, diff.field);
  if (!rule) return false;
  if (rule.allowedPairs) {
    return rule.allowedPairs.some((pair) => (
      (diff.a === pair[0] && diff.b === pair[1]) || (diff.a === pair[1] && diff.b === pair[0])
    ));
  }
  if (rule.clearOnly) return diff.a == null || diff.b == null;
  return false;
}

export function compareMigrationDirs(aDir, bDir, options = {}) {
  const aErrors = validateMigrationPackage(aDir);
  const bErrors = validateMigrationPackage(bDir);
  const differences = [];
  const duplicateKeys = [];
  if (!aErrors.length && !bErrors.length) {
    for (const [name, spec] of Object.entries(migrationSchema.tables)) {
      diffRows(name, spec, readPackageJson(aDir, spec.file), readPackageJson(bDir, spec.file), differences, duplicateKeys);
    }
  }
  const controlled = [];
  const blocking = [];
  for (const diff of differences) {
    if (options.allowControlledRuntime && diff.kind !== 'missing' && isControlled(diff)) controlled.push(diff);
    else blocking.push(diff);
  }
  return {
    equal: aErrors.length === 0 && bErrors.length === 0 && blocking.length === 0 && duplicateKeys.length === 0,
    packageErrors: { a: aErrors, b: bErrors },
    duplicateKeys,
    differences: blocking,
    controlledRuntimeDifferences: controlled,
  };
}

export function compareDistDirs(aDir, bDir, rules = []) {
  const aFiles = new Set(relativeFiles(aDir));
  const bFiles = new Set(relativeFiles(bDir));
  const missing = [];
  const hashDifferences = [];
  const normalizedDifferences = [];
  const ruleByPath = new Map(rules.map((rule) => [rule.path, rule]));
  for (const rel of aFiles) {
    if (!bFiles.has(rel)) missing.push({ path: rel, in: 'b' });
  }
  for (const rel of bFiles) {
    if (!aFiles.has(rel)) missing.push({ path: rel, in: 'a' });
  }
  for (const rel of aFiles) {
    if (!bFiles.has(rel)) continue;
    const aHash = sha256(fsSync.readFileSync(path.join(aDir, rel)));
    const bHash = sha256(fsSync.readFileSync(path.join(bDir, rel)));
    if (aHash === bHash) continue;
    const entry = { path: rel, a: aHash, b: bHash };
    const rule = ruleByPath.get(rel);
    if (rule) normalizedDifferences.push({ ...entry, rule: rule.reason });
    else hashDifferences.push(entry);
  }
  return {
    equal: missing.length === 0 && hashDifferences.length === 0,
    missing,
    hashDifferences,
    normalizedDifferences,
    normalizationRules: rules,
  };
}
