import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';
import probe from 'probe-image-size';

const CACHE_PATH = path.resolve('.cache/img-dims.json');

function loadCache() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))));
  } catch {
    return new Map();
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.${process.pid}.tmp`;
  const obj = Object.fromEntries(cache.entries());
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, CACHE_PATH);
}

export function remarkImageSize() {
  const cache = loadCache();
  let dirty = false;

  return async (tree) => {
    const jobs = [];
    visit(tree, 'image', (node) => {
      if (!/^https?:/.test(node.url)) return;
      jobs.push((async () => {
        if (!cache.has(node.url)) {
          try {
            const dim = await probe(node.url, { timeout: 8000 });
            cache.set(node.url, { width: dim.width, height: dim.height });
            dirty = true;
          } catch (error) {
            throw new Error(`[img] 新图片尺寸探测失败: ${node.url}`, { cause: error });
          }
        }
        const { width, height } = cache.get(node.url);
        node.data = {
          hProperties: {
            width,
            height,
            loading: 'lazy',
            decoding: 'async',
          },
        };
      })());
    });
    await Promise.all(jobs);
    if (dirty) saveCache(cache);
  };
}
