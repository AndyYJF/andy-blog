#!/usr/bin/env node
import { refreshShadowFromTypecho } from '../cms/src/lib/shadow-sync.js';
import {
  assertTypechoRestoreName,
  exitCode,
  exportTypechoPackage,
  loadPackageTables,
  openLocalDb,
  openShadowDb,
  parseMigrationArgs,
} from './lib/cms-migration-cli.js';

const args = parseMigrationArgs(process.argv.slice(2));
if (!args.packageDir) {
  console.error('usage: cms-shadow-sync.js --package dir [--execute]');
  process.exit(64);
}

try {
  assertTypechoRestoreName(process.env.DB_NAME);
  const shadow = args.dryRun ? null : await openShadowDb();
  const typecho = await openLocalDb();
  try {
    if (args.dryRun) {
      const exported = await exportTypechoPackage(typecho, args.packageDir, process.env.CMS_UPLOAD_ROOT || '');
      const tables = loadPackageTables(args.packageDir);
      const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
      process.stdout.write(`${JSON.stringify({ dryRun: true, ...exported, counts })}\n`);
    } else {
      try {
        const applied = await refreshShadowFromTypecho(
          typecho,
          shadow,
          args.packageDir,
          process.env.CMS_UPLOAD_ROOT || '',
        );
        process.stdout.write(`${JSON.stringify({ dryRun: false, ...applied })}\n`);
      } finally {
        await shadow.end();
      }
    }
  } finally {
    await typecho.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCode(error));
}
