/**
 * Rewrite a copied 302 release into an independent 301 release in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPreheatPlan, createPurgePlan } from './cdn-purge-core.js';
import { compareNginxPolicy301Flip } from './compare-nginx-policy.js';
import { flipLegacyReturns302to301 } from './flip-1panel-legacy-status.js';

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const releaseDir = arg('--release-dir');
const releaseId = arg('--release-id');
const fromId = arg('--from-id');
const legacyMapPath = arg('--legacy-map');
if (!releaseDir || !releaseId || !fromId || !legacyMapPath) {
  throw new Error('usage: node scripts/materialize-301-release.js --release-dir <dir> --release-id <id> --from-id <id> --legacy-map <file>');
}
if (!/^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(releaseId) || !/^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(fromId)) {
  throw new Error('bad release id');
}

const nginxPath = path.join(releaseDir, 'nginx', 'release-http.conf');
const nginxText = fs.readFileSync(nginxPath, 'utf8');
if (!nginxText.includes('# redirect status: 302')) {
  throw new Error('source release nginx is not 302');
}
const flipped = flipLegacyReturns302to301(nginxText).replace('# redirect status: 302', '# redirect status: 301');
const policy = compareNginxPolicy301Flip(nginxText, flipped);
if (!policy.ok) throw new Error(policy.reason);
if (flipped.includes('# redirect status: 302') || flipped.includes('return 302 https://www.andy-y.cn$legacy_')) {
  throw new Error('301 nginx still contains 302 legacy returns');
}
fs.writeFileSync(nginxPath, flipped);

const nginxManifestPath = path.join(releaseDir, 'nginx', 'release-manifest.json');
if (fs.existsSync(nginxManifestPath)) {
  const nginxManifest = JSON.parse(fs.readFileSync(nginxManifestPath, 'utf8'));
  nginxManifest.redirectStatus = 301;
  nginxManifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(nginxManifestPath, `${JSON.stringify(nginxManifest, null, 2)}\n`);
}

const manifestPath = path.join(releaseDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.releaseId !== fromId || Number(manifest.redirectStatus) !== 302 || manifest.commentWriteMode !== 'enabled') {
  throw new Error('source manifest is not the expected 302+enabled release');
}
manifest.releaseId = releaseId;
manifest.redirectStatus = 301;
manifest.parentReleaseId = fromId;
manifest.generatedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const markerPath = path.join(releaseDir, 'site', 'release-id.txt');
if (fs.readFileSync(markerPath, 'utf8').trim() !== fromId) {
  throw new Error('source release-id marker mismatch');
}
fs.writeFileSync(markerPath, `${releaseId}\n`);

const legacy = JSON.parse(fs.readFileSync(legacyMapPath, 'utf8'));
const purgePath = path.join(releaseDir, 'cdn-purge-plan.json');
const purgePlan = createPurgePlan({ releaseId, legacy });
fs.writeFileSync(purgePath, `${JSON.stringify(purgePlan, null, 2)}\n`);
const preheatPath = path.join(releaseDir, 'cdn-preheat-plan.json');
if (fs.existsSync(preheatPath)) {
  const previousPreheat = JSON.parse(fs.readFileSync(preheatPath, 'utf8'));
  const preheatPlan = createPreheatPlan({ releaseId, urls: previousPreheat.urls });
  fs.writeFileSync(preheatPath, `${JSON.stringify(preheatPlan, null, 2)}\n`);
}

console.log(JSON.stringify({ ok: true, releaseId, fromId, purgeUrls: purgePlan.urls.length }));
