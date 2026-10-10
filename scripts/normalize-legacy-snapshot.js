#!/usr/bin/env node
import { normalizeLegacySnapshot } from './lib/cms-contract.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: normalize-legacy-snapshot.js in.json out.json');
  process.exit(64);
}
const result = await normalizeLegacySnapshot(input, output);
if (result.code !== 0) {
  console.error(JSON.stringify(result.report));
  process.exit(result.code);
}
process.stdout.write(`${JSON.stringify({ ok: true, report: result.reportPath })}\n`);
