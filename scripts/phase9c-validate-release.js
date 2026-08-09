/** Validate an immutable 1Panel Phase 9c comment-enable release. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const CLOSED_KEY = '/posts/typecho-joe-mermaid/';
export const OPEN_KEY = '/posts/stable-diffusion-notes-p1/';
export const EXPECTED_POLICY_ENTRIES = 15;

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function parseArgs(argv) {
  const allowed = new Set(['--release-dir', '--release-id']);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(option)) throw new Error(`unknown option: ${option}`);
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${option}`);
    if (result[option]) throw new Error(`duplicate option: ${option}`);
    result[option] = value;
  }
  return result;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walkFiles(root, relative = '') {
  const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    const absolute = path.join(root, child);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`release contains unsupported entry: ${child}`);
    }
    if (stat.isDirectory()) files.push(...walkFiles(root, child));
    else files.push(child.replaceAll(path.sep, '/'));
  }
  return files.sort();
}

export function validatePolicy(policy) {
  if (policy.writeEnabled !== true) throw new Error('comment policy is not globally enabled');
  const keys = Object.keys(policy.entries || {}).sort();
  if (keys.length !== EXPECTED_POLICY_ENTRIES) {
    throw new Error(`comment policy entry count drifted: ${keys.length}`);
  }
  const closed = keys.filter((key) => policy.entries[key]?.writable !== true);
  if (closed.length !== 1 || closed[0] !== CLOSED_KEY) {
    throw new Error(`closed comment keys drifted: ${closed.join(',')}`);
  }
  if (policy.entries[OPEN_KEY]?.writable !== true) throw new Error('open probe key is not writable');
  return { entries: keys.length, writable: keys.length - closed.length, closed };
}

export function validateRelease({ releaseDir, releaseId }) {
  if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(releaseId)) throw new Error('bad release id');
  const absolute = path.resolve(releaseDir);
  const requiredFiles = [
    'manifest.json', 'comment-policy.json', 'checksums.sha256',
    'site/release-id.txt', 'site/index.html', 'nginx/release-http.conf',
  ];
  for (const relative of requiredFiles) {
    if (!fs.statSync(path.join(absolute, relative)).isFile()) throw new Error(`missing ${relative}`);
  }
  const files = walkFiles(absolute);
  const marker = fs.readFileSync(path.join(absolute, 'site/release-id.txt'), 'utf8').trim();
  if (marker !== releaseId) throw new Error(`release marker mismatch: ${marker}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(absolute, 'manifest.json'), 'utf8'));
  if (manifest.releaseId !== releaseId || manifest.redirectStatus !== 302
      || manifest.commentWriteMode !== 'enabled' || manifest.productionWriteEnabled !== true) {
    throw new Error('manifest is not the requested 302 + enabled release');
  }
  const policy = JSON.parse(fs.readFileSync(path.join(absolute, 'comment-policy.json'), 'utf8'));
  const policySummary = validatePolicy(policy);
  const checksumLines = fs.readFileSync(path.join(absolute, 'checksums.sha256'), 'utf8')
    .trim().split(/\r?\n/).filter(Boolean);
  const expectedFiles = files.filter((file) => file !== 'checksums.sha256');
  const recorded = new Map();
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || recorded.has(match[2])) throw new Error(`bad checksum line: ${line}`);
    recorded.set(match[2], match[1]);
  }
  if (recorded.size !== expectedFiles.length) throw new Error('checksum file count mismatch');
  for (const relative of expectedFiles) {
    if (recorded.get(relative) !== sha256(path.join(absolute, relative))) {
      throw new Error(`checksum mismatch: ${relative}`);
    }
  }
  return { releaseId, files: expectedFiles.length, policy: policySummary };
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = validateRelease({
    releaseDir: required(args['--release-dir'], '--release-dir'),
    releaseId: required(args['--release-id'], '--release-id'),
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...summary })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message })}\n`);
    process.exitCode = 1;
  }
}
