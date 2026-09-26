/**
 * rendererFingerprint — sha256 over everything that changes markdown → HTML
 * output. Stored in i18n-selection.json / release manifest so a verification
 * verdict is visibly tied to the environment that produced it
 * (docs/i18n-p2-design-2026-09-26.md §6).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function rendererFingerprint(astroDir) {
  const hash = crypto.createHash('sha256');
  const files = [
    'package-lock.json',
    'astro.config.mjs',
    path.join('src', 'lib', 'markdown-pipeline.mjs'),
    path.join('src', 'lib', 'beoe-cache.js'),
  ];
  const pluginsDir = path.join(astroDir, 'src', 'plugins');
  for (const name of fs.readdirSync(pluginsDir).sort()) {
    if (name.endsWith('.js')) files.push(path.join('src', 'plugins', name));
  }
  for (const rel of files) {
    const abs = path.join(astroDir, rel);
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(abs));
    hash.update('\0');
  }
  return hash.digest('hex');
}
