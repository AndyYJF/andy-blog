/**
 * Write release manifest + candidate nginx entry configs into .cache /
 * the staging release directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const releaseId = arg('--release-id');
const redirectStatus = Number(arg('--redirect-status'));
const commentWriteMode = arg('--comment-write-mode');
if (!releaseId || !/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(releaseId)) {
  throw new Error(`bad release id: ${releaseId}`);
}
if (redirectStatus !== 302 && redirectStatus !== 301) {
  throw new Error(`bad redirect status: ${redirectStatus}`);
}
if (commentWriteMode !== 'disabled' && commentWriteMode !== 'enabled') {
  throw new Error(`bad comment mode: ${commentWriteMode}`);
}

const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'route-map.json'), 'utf8'));
const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'legacy-url-map.json'), 'utf8'));
const lastmod = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'lastmod.json'), 'utf8'));

const active = Object.entries(routeMap)
  .filter(([, v]) => v.state === 'active')
  .map(([cid, v]) => ({ cid: Number(cid), ...v }))
  .sort((a, b) => a.cid - b.cid);

const manifest = {
  releaseId,
  snapshotEpoch: process.env.SNAPSHOT_EPOCH || null,
  redirectStatus,
  commentWriteMode,
  productionWriteEnabled: commentWriteMode === 'enabled',
  generatedAt: new Date().toISOString(),
  counts: {
    activeRoutes: active.length,
    legacyEntries: legacy.length,
    lastmodKeys: Object.keys(lastmod).length,
  },
  activeCids: active.map((a) => a.cid),
};

const outDir = path.join(ROOT, '.cache');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const generatedDir = path.join(ROOT, 'astro', 'src', 'generated');
fs.mkdirSync(generatedDir, { recursive: true });
const releaseStateTs = `export const releaseState = {
  productionWriteEnabled: ${commentWriteMode === 'enabled'},
  commentWriteMode: ${JSON.stringify(commentWriteMode)},
  redirectStatus: ${redirectStatus},
  releaseId: ${JSON.stringify(releaseId)},
} as const;
`;
fs.writeFileSync(path.join(generatedDir, 'release-state.ts'), releaseStateTs);
console.error(`manifest -> .cache/manifest.json (${releaseId})`);
console.error(`release-state -> astro/src/generated/release-state.ts (write=${commentWriteMode === 'enabled'})`);
