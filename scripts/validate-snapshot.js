#!/usr/bin/env node
import fs from 'node:fs/promises';
import { validateBuildSnapshot } from './lib/cms-contract.js';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: validate-snapshot.js file.json');
  process.exit(64);
}
const before = await fs.readFile(file);
const data = JSON.parse(before.toString('utf8'));
const errors = validateBuildSnapshot(data);
const after = await fs.readFile(file);
if (!before.equals(after)) {
  console.error('validate-snapshot.js modified its input');
  process.exit(1);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
