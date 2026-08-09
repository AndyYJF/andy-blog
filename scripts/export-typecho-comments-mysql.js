/** Export a deterministic, guard-protected Typecho comment snapshot. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { readFixedExport } from './lib/typecho-comment-export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const accepted = new Set(['--output', '--confirm-database', '--confirm-comments-table']);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!accepted.has(option)) throw new Error(`unknown option: ${option}`);
    if (result[option] !== undefined) throw new Error(`duplicate option: ${option}`);
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${option}`);
    result[option] = value;
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

export function validateTarget({ database, confirmedDatabase, commentsTable, confirmedCommentsTable, outputPath }) {
  if (database !== confirmedDatabase || /staging|waline/i.test(database)) {
    throw new Error('Typecho database confirmation failed');
  }
  if (commentsTable !== confirmedCommentsTable || commentsTable !== 'typecho_comments') {
    throw new Error('Typecho comments table confirmation failed');
  }
  if (!path.isAbsolute(outputPath) || isInside(ROOT, outputPath)) {
    throw new Error('--output must be an absolute path outside the repository');
  }
  if (!fs.statSync(path.dirname(outputPath)).isDirectory()) throw new Error('output parent must exist');
  if (fs.existsSync(outputPath)) throw new Error('output already exists');
}

export function writeExclusive(outputPath, bytes) {
  const descriptor = fs.openSync(outputPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(required(args['--output'], '--output'));
  const database = required(process.env.TYPECHO_MYSQL_DATABASE, 'TYPECHO_MYSQL_DATABASE');
  const commentsTable = required(process.env.TYPECHO_MYSQL_COMMENTS_TABLE, 'TYPECHO_MYSQL_COMMENTS_TABLE');
  validateTarget({
    database,
    confirmedDatabase: required(args['--confirm-database'], '--confirm-database'),
    commentsTable,
    confirmedCommentsTable: required(args['--confirm-comments-table'], '--confirm-comments-table'),
    outputPath,
  });
  const connection = await mysql.createConnection({
    host: required(process.env.TYPECHO_MYSQL_HOST, 'TYPECHO_MYSQL_HOST'),
    port: Number(process.env.TYPECHO_MYSQL_PORT || 3306),
    user: required(process.env.TYPECHO_MYSQL_USER, 'TYPECHO_MYSQL_USER'),
    password: required(process.env.TYPECHO_MYSQL_PASSWORD, 'TYPECHO_MYSQL_PASSWORD'),
    database,
    timezone: 'Z',
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    const fixed = await readFixedExport({ connection, database, commentsTable });
    writeExclusive(outputPath, fixed.bytes);
    process.stdout.write(`${JSON.stringify({ ok: true, ...fixed.summary })}\n`);
  } finally {
    await connection.end();
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'EXPORT_FAILED', message: error.message })}\n`);
    process.exitCode = 1;
  });
}
