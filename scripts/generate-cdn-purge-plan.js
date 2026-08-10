#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPurgePlan } from './cdn-purge-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const releaseId = valueFor('--release-id');
const out = path.resolve(ROOT, valueFor('--out'));
const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/legacy-url-map.json'), 'utf8'));
const plan = createPurgePlan({ releaseId, legacy });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`${JSON.stringify({ out: path.relative(ROOT, out), releaseId, urls: plan.urls.length, sha256: plan.sha256 })}\n`);
