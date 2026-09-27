#!/usr/bin/env node
/**
 * i18n publish receipt observer (§10 发布回执).
 *
 * Runs on the host right after a release is switched live. Reads the
 * release manifest's localizedEntries and emits idempotent SQL marking the
 * matching publish-outbox events 'live' and advancing the publication
 * ledger's first_published_at / last_live_* fields.
 *
 * Usage:
 *   node scripts/i18n-observe-live.js --release-dir <abs path> --prefix typecho_ \
 *     | docker exec -i <mysql container> sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <db>'
 *
 * No npm deps (host node v18). Emits SQL only; the caller owns the
 * connection so credentials never touch this script.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const releaseDir = valueFor('--release-dir', '');
const prefix = valueFor('--prefix', 'typecho_');

if (!releaseDir || !path.isAbsolute(releaseDir)) {
  console.error('--release-dir must be an absolute path');
  process.exit(64);
}
if (!/^[A-Za-z0-9_]+$/.test(prefix)) {
  console.error('bad --prefix');
  process.exit(64);
}

const manifestPath = path.join(releaseDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`manifest.json missing in ${releaseDir}`);
  process.exit(66);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const releaseId = String(manifest.releaseId || path.basename(releaseDir));
if (!/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(releaseId)) {
  console.error(`bad release id: ${releaseId}`);
  process.exit(64);
}

const entries = Array.isArray(manifest.localizedEntries) ? manifest.localizedEntries : [];
const statements = [];
let observed = 0;
for (const entry of entries) {
  const versionId = Number(entry?.translationVersionId);
  const cid = Number(entry?.sourceCid);
  const locale = String(entry?.locale || '');
  if (!entry?.renderExpected || !Number.isInteger(versionId) || !Number.isInteger(cid)) continue;
  if (!/^[a-z]{2}(-[a-zA-Z]{2})?$/.test(locale)) continue;
  observed += 1;
  statements.push(
    `UPDATE ${prefix}i18n_publish_outbox SET status='live', release_id='${releaseId}', observed_at=UNIX_TIMESTAMP(), updated_at=UNIX_TIMESTAMP() WHERE version_id=${versionId} AND cid=${cid} AND locale='${locale}' AND status IN ('pending','accepted');`,
  );
  statements.push(
    `UPDATE ${prefix}i18n_publication_ledger SET first_published_at=IFNULL(first_published_at,UNIX_TIMESTAMP()), last_live_version_id=${versionId}, last_live_release='${releaseId}', updated_at=UNIX_TIMESTAMP() WHERE cid=${cid} AND locale='${locale}';`,
  );
}

process.stdout.write(`${statements.join('\n')}\n`);
process.stderr.write(`i18n-observe-live: ${observed} live entries for release ${releaseId}\n`);
