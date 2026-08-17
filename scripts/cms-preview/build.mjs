#!/usr/bin/env node
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'typecho/usr/plugins/AstroPreview/assets');
const katexDir = path.join(root, 'astro/node_modules/katex/dist');

await fs.promises.mkdir(outDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'scripts/cms-preview/browser.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: path.join(outDir, 'preview.js'),
  minify: true,
  legalComments: 'none',
  alias: {
    katex: path.join(katexDir, 'katex.mjs'),
  },
});

await fs.promises.copyFile(
  path.join(root, 'scripts/cms-preview/preview.css'),
  path.join(outDir, 'preview.css'),
);
await fs.promises.copyFile(path.join(katexDir, 'katex.min.css'), path.join(outDir, 'katex.min.css'));

const fontSrc = path.join(katexDir, 'fonts');
const fontDest = path.join(outDir, 'fonts');
await fs.promises.mkdir(fontDest, { recursive: true });
for (const name of await fs.promises.readdir(fontSrc)) {
  if (!/\.(woff2|woff|ttf)$/i.test(name)) continue;
  await fs.promises.copyFile(path.join(fontSrc, name), path.join(fontDest, name));
}

const mermaidCandidates = [
  path.join(root, 'node_modules/mermaid/dist/mermaid.min.js'),
  path.join(root, 'astro/node_modules/mermaid/dist/mermaid.min.js'),
];
let mermaidCopied = false;
for (const candidate of mermaidCandidates) {
  if (!fs.existsSync(candidate)) continue;
  await fs.promises.copyFile(candidate, path.join(outDir, 'mermaid.min.js'));
  mermaidCopied = true;
  break;
}

console.log(`AstroPreview assets → ${outDir}`);
if (!mermaidCopied) {
  console.warn('mermaid.min.js not found; mermaid fences will stay as source until the file is provided');
}
