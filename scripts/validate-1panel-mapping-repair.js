#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRelease } from './phase9c-validate-release.js';
import { verifyPurgePlan } from './cdn-purge-core.js';

export const ENCODED_MAP_LINE = '  ~^/index\\.php/tag/%E5%88%86%E6%9E%90fen-x/$ "/tag/fen-x/";';
export const DECODED_MAP_LINE = '  ~^/index\\.php/tag/分析fen-x/$ "/tag/fen-x/";';

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

export function validateExactMappingDiff(currentConfig, candidateConfig) {
  const current = currentConfig.replaceAll('\r\n', '\n');
  const candidate = candidateConfig.replaceAll('\r\n', '\n');
  if (occurrences(current, ENCODED_MAP_LINE) !== 1 || occurrences(current, DECODED_MAP_LINE) !== 0) {
    throw new Error('current vhost does not contain exactly one encoded mapping and no decoded mapping');
  }
  if (occurrences(candidate, ENCODED_MAP_LINE) !== 0 || occurrences(candidate, DECODED_MAP_LINE) !== 1) {
    throw new Error('candidate vhost does not contain exactly one decoded mapping and no encoded mapping');
  }
  if (current.replace(ENCODED_MAP_LINE, DECODED_MAP_LINE) !== candidate) {
    throw new Error('candidate vhost contains changes outside the single reviewed mapping line');
  }
  return { removed: ENCODED_MAP_LINE, added: DECODED_MAP_LINE };
}

export function buildExactMappingCandidate(currentConfig) {
  const current = currentConfig.replaceAll('\r\n', '\n');
  const candidate = current.replace(ENCODED_MAP_LINE, DECODED_MAP_LINE);
  validateExactMappingDiff(current, candidate);
  return candidate;
}

function valueFor(args, option) {
  const index = args.indexOf(option);
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${option}`);
  return args[index + 1];
}

export function validateMappingRepair({ currentVhost, candidateVhost, releaseDir, releaseId }) {
  const release = validateRelease({ releaseDir, releaseId });
  const planFile = path.join(releaseDir, 'cdn-purge-plan.json');
  if (!fs.statSync(planFile).isFile()) throw new Error('candidate release is missing cdn-purge-plan.json');
  const plan = verifyPurgePlan(JSON.parse(fs.readFileSync(planFile, 'utf8')), releaseId);
  const diff = validateExactMappingDiff(
    fs.readFileSync(currentVhost, 'utf8'),
    fs.readFileSync(candidateVhost, 'utf8'),
  );
  return { release, plan: { urls: plan.urls.length, sha256: plan.sha256 }, diff };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--write-candidate')) {
    const currentVhost = valueFor(args, '--current-vhost');
    const candidateVhost = valueFor(args, '--write-candidate');
    const candidate = buildExactMappingCandidate(fs.readFileSync(currentVhost, 'utf8'));
    fs.writeFileSync(candidateVhost, candidate, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ok: true, candidateVhost, diff: validateExactMappingDiff(fs.readFileSync(currentVhost, 'utf8'), candidate) })}\n`);
    return;
  }
  const summary = validateMappingRepair({
    currentVhost: valueFor(args, '--current-vhost'),
    candidateVhost: valueFor(args, '--candidate-vhost'),
    releaseDir: valueFor(args, '--release-dir'),
    releaseId: valueFor(args, '--release-id'),
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...summary })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message })}\n`);
    process.exitCode = 1;
  }
}
