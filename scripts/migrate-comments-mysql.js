/**
 * Stage 10 Typecho -> production Waline migration CLI.
 *
 * This command is fail-closed and defaults to a transaction that is rolled
 * back. Source exports and reports must stay outside the repository.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { buildPreparedSource, sha256 } from './lib/comment-migration-core.js';
import { runMysqlMigration } from './lib/comment-migration-mysql.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const valueOptions = new Set([
    '--source', '--report', '--confirm-database', '--confirm-source-sha',
    '--lock-timeout-seconds',
  ]);
  const flagOptions = new Set(['--apply', '--apply-sweep', '--twice']);
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (flagOptions.has(option)) {
      if (result[option] !== undefined) throw new Error(`duplicate option: ${option}`);
      result[option] = true;
      continue;
    }
    if (!valueOptions.has(option)) throw new Error(`unknown option: ${option}`);
    if (result[option] !== undefined) throw new Error(`duplicate option: ${option}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${option}`);
    result[option] = value;
    index += 1;
  }
  return result;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function validateExternalFilePaths(sourcePath, reportPath) {
  if (!path.isAbsolute(sourcePath)) throw new Error('--source must be an absolute path');
  if (!path.isAbsolute(reportPath)) throw new Error('--report must be an absolute path');
  if (isInside(ROOT, sourcePath)) throw new Error('--source must stay outside the repository');
  if (isInside(ROOT, reportPath)) throw new Error('--report must stay outside the repository');
  if (path.resolve(sourcePath) === path.resolve(reportPath)) throw new Error('--source and --report must differ');
  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile()) throw new Error('--source must name a regular file');
  if (process.platform !== 'win32' && (sourceStat.mode & 0o077) !== 0) {
    throw new Error('--source must not be group/world readable; use chmod 600');
  }
  const reportParent = path.dirname(reportPath);
  if (!fs.statSync(reportParent).isDirectory()) throw new Error('--report parent must be an existing directory');
  if (fs.existsSync(reportPath)) throw new Error('--report already exists; choose a new evidence path');
}

function parsePositiveInteger(value, label, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 120) {
    throw new Error(`${label} must be an integer from 1 to 120`);
  }
  return Number(value);
}

function digestIds(values, { includeIds = false } = {}) {
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  return {
    count: sorted.length,
    sha256: sha256(JSON.stringify(sorted)),
    ...(includeIds ? { legacyCoids: sorted } : {}),
  };
}

function summarizePass(pass) {
  const driftFields = {};
  for (const item of pass.repairedDrift) {
    for (const field of item.fields) driftFields[field] = (driftFields[field] || 0) + 1;
  }
  return {
    inserted: pass.inserted,
    updated: pass.updated,
    deleted: pass.deleted,
    insertedLegacyCoids: digestIds(pass.insertedLegacyCoids),
    updatedLegacyCoids: digestIds(pass.updatedLegacyCoids),
    deletedLegacyCoids: digestIds(pass.deletedLegacyCoids, { includeIds: true }),
    pendingAbsentLegacyCoids: digestIds(pass.pendingAbsentLegacyCoids, { includeIds: true }),
    repairedDriftCount: pass.repairedDrift.length,
    repairedDriftFields: driftFields,
  };
}

function summarizeReconciliation(value) {
  return {
    ok: value.ok,
    sourceSelected: value.sourceSelected,
    mappings: value.mappings,
    mappedComments: value.mappedComments,
    nativeWalineComments: value.nativeWalineComments,
    missingMappings: digestIds(value.missingMappings),
    extraMappings: digestIds(value.extraMappings),
    missingComments: digestIds(value.missingComments),
    duplicateWalineIds: digestIds(value.duplicateWalineIds),
    sourceHashMismatches: digestIds(value.sourceHashMismatches),
    commentMismatchCount: value.commentMismatches.length,
    commentMismatchSha256: sha256(JSON.stringify(value.commentMismatches)),
  };
}

export function reportFromResult({ result, sourceSha256, database }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    target: { database, sourceNamespace: 'typecho' },
    sourceSnapshot: { sha256: sourceSha256, ...result.sourceCounts },
    mode: result.mode,
    applySweep: result.applySweep,
    committed: result.committed,
    ok: result.ok,
    blockers: result.blockers,
    first: summarizePass(result.first),
    second: summarizePass(result.second),
    secondNoop: result.secondNoop,
    reconciliation: summarizeReconciliation(result.reconciliation),
    privacy: 'counts/hashes plus pending/deleted legacy_coid keys; no comment body, mail, IP, user agent, or source path',
  };
}

function writeExclusiveReport(reportPath, report) {
  const descriptor = fs.openSync(reportPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = path.resolve(required(args['--source'], '--source'));
  const reportPath = path.resolve(required(args['--report'], '--report'));
  const database = required(process.env.WALINE_MYSQL_DATABASE, 'WALINE_MYSQL_DATABASE');
  const confirmedDatabase = required(args['--confirm-database'], '--confirm-database');
  const apply = Boolean(args['--apply']);
  const applySweep = Boolean(args['--apply-sweep']);
  if (!args['--twice']) throw new Error('--twice is mandatory for production migration');
  if (database !== 'waline' || confirmedDatabase !== database || /staging/i.test(database)) {
    throw new Error('target guard failed: only confirmed production database waline is allowed');
  }
  validateExternalFilePaths(sourcePath, reportPath);

  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  if (apply) {
    const confirmedSourceSha = required(args['--confirm-source-sha'], '--confirm-source-sha');
    if (!/^[a-f0-9]{64}$/i.test(confirmedSourceSha) || confirmedSourceSha.toLowerCase() !== sourceSha256) {
      throw new Error('source snapshot confirmation failed: SHA-256 does not match');
    }
  }
  const sourceRows = JSON.parse(sourceBytes.toString('utf8'));
  const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/route-map.json'), 'utf8'));
  const prepared = buildPreparedSource(sourceRows, routeMap);

  const connection = await mysql.createConnection({
    host: required(process.env.WALINE_MYSQL_HOST, 'WALINE_MYSQL_HOST'),
    port: Number(process.env.WALINE_MYSQL_PORT || 3306),
    user: required(process.env.WALINE_MYSQL_USER, 'WALINE_MYSQL_USER'),
    password: required(process.env.WALINE_MYSQL_PASSWORD, 'WALINE_MYSQL_PASSWORD'),
    database,
    timezone: 'Z',
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    const result = await runMysqlMigration({
      connection,
      database,
      prepared,
      apply,
      applySweep,
      twice: true,
      lockTimeoutSeconds: parsePositiveInteger(args['--lock-timeout-seconds'], '--lock-timeout-seconds', 10),
    });
    const report = reportFromResult({ result, sourceSha256, database });
    writeExclusiveReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
  } finally {
    await connection.end();
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    const safe = {
      ok: false,
      code: error.code || 'MIGRATION_FAILED',
      message: error.message,
    };
    process.stderr.write(`${JSON.stringify(safe)}\n`);
    process.exitCode = 1;
  });
}
