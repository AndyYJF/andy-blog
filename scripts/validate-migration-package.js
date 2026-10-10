#!/usr/bin/env node
import { validateMigrationPackage } from './lib/cms-contract.js';

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('usage: validate-migration-package.js package-dir');
  process.exit(64);
}
const errors = validateMigrationPackage(dir);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
