#!/usr/bin/env node
import fs from 'node:fs/promises';
import { compareSnapshotData } from './lib/cms-contract.js';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: compare-snapshots.js a.json b.json');
  process.exit(64);
}
const report = compareSnapshotData(
  JSON.parse(await fs.readFile(a, 'utf8')),
  JSON.parse(await fs.readFile(b, 'utf8')),
);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.equal ? 0 : 1);
