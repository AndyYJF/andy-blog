#!/usr/bin/env node
import fs from 'node:fs';
import { compareDistDirs } from './lib/cms-contract.js';

const args = process.argv.slice(2);
const flag = args.indexOf('--normalize');
let rules = [];
const dirs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--normalize') {
    rules = JSON.parse(fs.readFileSync(args[i + 1], 'utf8')).rules || [];
    i += 1;
    continue;
  }
  dirs.push(args[i]);
}
if (dirs.length !== 2 || flag === args.length - 1) {
  console.error('usage: compare-dist.js a-dir b-dir [--normalize rules.json]');
  process.exit(64);
}
for (const rule of rules) {
  if (!rule.path || rule.path.includes('..') || !rule.reason) {
    console.error('normalization rules need a relative path and a reason');
    process.exit(64);
  }
}
const report = compareDistDirs(dirs[0], dirs[1], rules);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.equal ? 0 : 1);
