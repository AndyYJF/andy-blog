#!/usr/bin/env node
/**
 * Compare a shadow candidate in order: private package, build snapshot,
 * Markdown, manifests, then dist. Dist is omitted until both directories exist.
 * Exit 0 only when every stage, including dist, matches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareDistDirs, compareMigrationDirs, compareSnapshotData } from './lib/cms-contract.js';

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const args = process.argv.slice(2);

function take(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const pair = args.slice(index + 1, index + 3);
  if (pair.length !== 2 || pair.some((item) => !item || item.startsWith('--'))) {
    fail(64, `${flag} needs two paths`);
  }
  return pair;
}

function assertSafe(file) {
  if (!file || file.includes('..') || !path.isAbsolute(file)) {
    fail(65, `refuses path ${file || ''}`);
  }
}

const privatePair = take('--private');
const snapshotPair = take('--snapshot');
const markdownPair = take('--markdown');
const manifestPair = take('--manifest');
const distPair = take('--dist');
if (!privatePair || !snapshotPair || !markdownPair || !manifestPair) {
  fail(64, 'usage: cms-shadow-diff.js --private a b --snapshot a b --markdown a b --manifest a b [--dist a b]');
}
for (const pair of [privatePair, snapshotPair, markdownPair, manifestPair, distPair].filter(Boolean)) {
  pair.forEach(assertSafe);
}

function directoryStage(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) {
    return {
      equal: false,
      missing: [
        ...(!fs.existsSync(left) ? [{ path: left, in: 'a' }] : []),
        ...(!fs.existsSync(right) ? [{ path: right, in: 'b' }] : []),
      ],
    };
  }
  return compareDistDirs(left, right);
}

function snapshotStage(left, right) {
  try {
    const report = compareSnapshotData(
      JSON.parse(fs.readFileSync(left, 'utf8')),
      JSON.parse(fs.readFileSync(right, 'utf8')),
    );
    return { equal: report.equal, differences: report.differences, duplicateKeys: report.duplicateKeys };
  } catch (error) {
    return { equal: false, differences: [{ kind: 'unreadable', message: error instanceof Error ? error.message : 'unreadable' }] };
  }
}

const stages = {
  private: compareMigrationDirs(privatePair[0], privatePair[1]),
  snapshot: snapshotStage(snapshotPair[0], snapshotPair[1]),
  markdown: directoryStage(markdownPair[0], markdownPair[1]),
  manifest: directoryStage(manifestPair[0], manifestPair[1]),
};
const contentEqual = ['private', 'snapshot', 'markdown', 'manifest'].every((name) => stages[name].equal);
if (distPair) {
  stages.dist = { compared: true, ...directoryStage(distPair[0], distPair[1]) };
} else {
  stages.dist = { compared: false, equal: false, reason: 'dist was not built' };
}
const report = {
  equal: contentEqual && stages.dist.compared === true && stages.dist.equal === true,
  complete: contentEqual && stages.dist.compared === true && stages.dist.equal === true,
  stages,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!contentEqual || (stages.dist.compared && !stages.dist.equal)) process.exit(1);
if (!stages.dist.compared) process.exit(65);
process.exit(0);
