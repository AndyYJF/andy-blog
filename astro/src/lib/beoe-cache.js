import fs from 'node:fs';
import path from 'node:path';

/**
 * File-backed Map for @beoe/rehype-code-hook (hashTostring keys).
 * Persists under astro/.cache so offbox builds can skip Playwright for
 * unchanged mermaid fences.
 *
 * On get(), if a cached HAST still points at /beoe/*.svg files that are
 * missing from public/beoe, treat as a miss so Playwright re-renders.
 */
export function createBeoeCache(filePath = path.resolve('.cache/beoe-cache.json')) {
  /** @type {Map<string, unknown>} */
  let map;
  try {
    map = new Map(Object.entries(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
  } catch {
    map = new Map();
  }

  let dirty = false;

  const flush = () => {
    if (!dirty) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(map))}\n`);
    fs.renameSync(tmp, filePath);
    dirty = false;
  };

  process.once('beforeExit', flush);
  process.once('exit', flush);

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  const beoeAssetsExist = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object') return true;
    const json = JSON.stringify(value);
    const srcs = [...json.matchAll(/"\/beoe\/([^"]+\.svg)"/g)].map((m) => m[1]);
    for (const name of srcs) {
      if (!fs.existsSync(path.resolve('public', 'beoe', name))) return false;
    }
    return true;
  };

  return {
    /**
     * @param {string} key
     */
    get(key) {
      const k = typeof key === 'string' ? key : String(key);
      const value = map.get(k);
      if (value === undefined) return undefined;
      if (!beoeAssetsExist(value)) {
        map.delete(k);
        dirty = true;
        flush();
        return undefined;
      }
      return value;
    },
    /**
     * @param {string} key
     * @param {unknown} value
     */
    set(key, value) {
      const k = typeof key === 'string' ? key : String(key);
      map.set(k, value);
      dirty = true;
      // Write-through once the HAST node is ready (skip in-flight promises).
      if (value !== null && (typeof value !== 'object' || !('then' in /** @type {object} */ (value)))) {
        flush();
      }
    },
  };
}
