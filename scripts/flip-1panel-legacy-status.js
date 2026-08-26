/**
 * Flip only 1Panel www vhost / release-http.conf legacy returns 302 -> 301.
 * Query-target replacements must run before path-target because the latter
 * is a prefix of the former.
 */
import fs from 'node:fs';

export const LEGACY_QUERY_FROM = 'return 302 https://www.andy-y.cn$legacy_query_target';
export const LEGACY_QUERY_TO = 'return 301 https://www.andy-y.cn$legacy_query_target';
export const LEGACY_PATH_FROM = 'return 302 https://www.andy-y.cn$legacy_target';
export const LEGACY_PATH_TO = 'return 301 https://www.andy-y.cn$legacy_target';

export const flipLegacyReturns302to301 = (text) => {
  const source = String(text);
  const queryHits = source.split(LEGACY_QUERY_FROM).length - 1;
  const pathHits = source.split(LEGACY_PATH_FROM).length - 1;
  if (queryHits === 0 || pathHits === 0) {
    throw new Error('vhost/release nginx is missing 302 legacy returns');
  }
  const flipped = source.replaceAll(LEGACY_QUERY_FROM, LEGACY_QUERY_TO).replaceAll(LEGACY_PATH_FROM, LEGACY_PATH_TO);
  if (flipped.includes(LEGACY_QUERY_FROM) || flipped.includes(LEGACY_PATH_FROM)) {
    throw new Error('leftover 302 legacy returns after flip');
  }
  if (flipped.split(LEGACY_QUERY_TO).length - 1 !== queryHits) {
    throw new Error('query-target flip count mismatch');
  }
  if (flipped.split(LEGACY_PATH_TO).length - 1 !== pathHits) {
    throw new Error('path-target flip count mismatch');
  }
  return flipped;
};

export const assertExactLegacy301Flip = (currentText, candidateText) => {
  const expected = flipLegacyReturns302to301(currentText);
  if (expected !== candidateText) {
    throw new Error('candidate is not an exact 302->301 legacy-return flip');
  }
  return { ok: true, queryHits: currentText.split(LEGACY_QUERY_FROM).length - 1, pathHits: currentText.split(LEGACY_PATH_FROM).length - 1 };
};

const invokedDirectly = String(process.argv[1] || '').replaceAll('\\', '/').endsWith('/flip-1panel-legacy-status.js');
if (invokedDirectly) {
  const mode = process.argv[2];
  if (mode === '--write-candidate') {
    const [, , , currentPath, candidatePath] = process.argv;
    if (!currentPath || !candidatePath) {
      console.error('usage: node scripts/flip-1panel-legacy-status.js --write-candidate <current> <candidate>');
      process.exit(64);
    }
    fs.writeFileSync(candidatePath, flipLegacyReturns302to301(fs.readFileSync(currentPath, 'utf8')));
    process.exit(0);
  }
  if (mode === '--validate') {
    const [, , , currentPath, candidatePath] = process.argv;
    if (!currentPath || !candidatePath) {
      console.error('usage: node scripts/flip-1panel-legacy-status.js --validate <current> <candidate>');
      process.exit(64);
    }
    const result = assertExactLegacy301Flip(
      fs.readFileSync(currentPath, 'utf8'),
      fs.readFileSync(candidatePath, 'utf8'),
    );
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  console.error('usage: node scripts/flip-1panel-legacy-status.js --write-candidate|--validate <current> <candidate>');
  process.exit(64);
}
