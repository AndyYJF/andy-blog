import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairKnownContent } from './lib/content-presentation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'astro/.cache/manifest.json'), 'utf8'));
const failures = [];

const splitDocument = (raw) => {
  const normalized = raw.replace(/\r\n/gu, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  if (!match) throw new Error('generated markdown is missing frontmatter');
  return { frontmatter: match[1], body: match[2] };
};

const removeDescription = (frontmatter) => frontmatter
  .split('\n')
  .filter((line) => !line.startsWith('description:'))
  .join('\n');

for (const entry of manifest.entries) {
  const kindDir = entry.kind === 'page' ? 'pages' : 'posts';
  const rel = `astro/src/content/${kindDir}/${entry.entryId}.md`;
  const current = splitDocument(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const baselineRaw = execFileSync(
    'git',
    ['-c', `safe.directory=${ROOT}`, '-C', ROOT, 'show', `HEAD:${rel}`],
    { encoding: 'utf8' },
  );
  const baseline = splitDocument(baselineRaw);
  const expectedBody = repairKnownContent(entry, baseline.body).text;

  if (removeDescription(current.frontmatter) !== baseline.frontmatter) {
    failures.push({ cid: entry.cid, rel, issue: 'frontmatter changed beyond description' });
  }
  if (current.body !== expectedBody) {
    failures.push({ cid: entry.cid, rel, issue: 'body changed beyond approved deterministic repair' });
  }
}

const report = {
  checked: manifest.entries.length,
  presentationOnly: failures.length === 0,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
