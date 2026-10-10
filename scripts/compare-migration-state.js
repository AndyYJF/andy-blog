#!/usr/bin/env node
import { compareMigrationDirs } from './lib/cms-contract.js';

const args = process.argv.slice(2);
const allowControlledRuntime = args.includes('--allow-controlled-runtime');
const dirs = args.filter((arg) => arg !== '--allow-controlled-runtime');
if (dirs.length !== 2) {
  console.error('usage: compare-migration-state.js a-dir b-dir [--allow-controlled-runtime]');
  process.exit(64);
}
const report = compareMigrationDirs(dirs[0], dirs[1], { allowControlledRuntime });
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.equal ? 0 : 1);
