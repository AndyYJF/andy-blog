import path from 'node:path';
import { ensureCmsSchema } from './schema.js';
import { applyMirror } from './import-apply.js';
import { exportCmsPackage, exportTypechoPackage, loadPackageTables } from '../../../scripts/lib/cms-migration-cli.js';

export async function refreshShadow(sourceDb, shadowDb, packageDir, uploadRoot) {
  const exported = await exportCmsPackage(sourceDb, packageDir, uploadRoot);
  const tables = loadPackageTables(packageDir);
  await ensureCmsSchema(shadowDb);
  const applied = await applyMirror(shadowDb, tables, {
    packageId: path.basename(packageDir),
    source: 'shadow-sync',
  });
  const now = Math.floor(Date.now() / 1000);
  await shadowDb.query(
    `INSERT INTO cms_runtime (id, mode, package_id, updated_at)
     VALUES (1, 'shadow', ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       mode = 'shadow',
       package_id = new.package_id,
       updated_at = new.updated_at`,
    [path.basename(packageDir), now],
  );
  return { ...exported, runId: applied.runId, counts: applied.counts };
}

export async function refreshShadowFromTypecho(typechoDb, shadowDb, packageDir, uploadRoot) {
  const exported = await exportTypechoPackage(typechoDb, packageDir, uploadRoot);
  const tables = loadPackageTables(packageDir);
  await ensureCmsSchema(shadowDb);
  const applied = await applyMirror(shadowDb, tables, {
    packageId: path.basename(packageDir),
    source: 'shadow-sync-typecho',
  });
  const now = Math.floor(Date.now() / 1000);
  await shadowDb.query(
    `INSERT INTO cms_runtime (id, mode, package_id, updated_at)
     VALUES (1, 'shadow', ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       mode = 'shadow',
       package_id = new.package_id,
       updated_at = new.updated_at`,
    [path.basename(packageDir), now],
  );
  return { ...exported, runId: applied.runId, counts: applied.counts };
}
