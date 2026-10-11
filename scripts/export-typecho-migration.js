#!/usr/bin/env node
import {
  assertTypechoRestoreName,
  exitCode,
  exportTypechoPackage,
  openLocalDb,
  parseMigrationArgs,
} from './lib/cms-migration-cli.js';

const args = parseMigrationArgs(process.argv.slice(2));
if (!args.packageDir) {
  console.error('usage: export-typecho-migration.js --package dir');
  process.exit(64);
}

try {
  assertTypechoRestoreName(process.env.DB_NAME);
  const db = await openLocalDb();
  try {
    const result = await exportTypechoPackage(db, args.packageDir, process.env.CMS_UPLOAD_ROOT || '');
    process.stdout.write(`${JSON.stringify({ ok: true, package: args.packageDir, ...result })}\n`);
  } finally {
    await db.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCode(error));
}
