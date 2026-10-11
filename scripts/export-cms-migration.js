#!/usr/bin/env node
import { ensureCmsSchema } from '../cms/src/lib/content-store.js';
import {
  assertCmsDatabaseName,
  assertOutputPackageDir,
  exitCode,
  exportCmsPackage,
  openLocalDb,
  parseMigrationArgs,
} from './lib/cms-migration-cli.js';

const args = parseMigrationArgs(process.argv.slice(2));
if (!args.packageDir) {
  console.error('usage: export-cms-migration.js --package dir');
  process.exit(64);
}

try {
  assertOutputPackageDir(args.packageDir);
  assertCmsDatabaseName(process.env.DB_NAME);
  const db = await openLocalDb();
  try {
    await ensureCmsSchema(db);
    const result = await exportCmsPackage(db, args.packageDir, process.env.CMS_UPLOAD_ROOT || '');
    process.stdout.write(`${JSON.stringify({ ok: true, package: args.packageDir, ...result })}\n`);
  } finally {
    await db.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCode(error));
}
