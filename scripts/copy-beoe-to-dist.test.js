import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { contentHasMermaid } from './lib/content-has-mermaid.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('mermaid SVGs are copied into dist and the render gate checks the files', () => {
  const pkg = fs.readFileSync(path.join(ROOT, 'astro', 'package.json'), 'utf8');
  const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'render-gate.js'), 'utf8');
  const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-beoe-to-dist.js'), 'utf8');
  assert.match(pkg, /copy-beoe-to-dist\.js/);
  assert.match(gate, /mermaid 产物缺失/);
  assert.match(copy, /path\.join\(ROOT, 'astro', 'public', 'beoe'\)/);
  assert.match(copy, /path\.join\(ROOT, 'astro', 'dist', 'beoe'\)/);
  assert.match(copy, /contentHasMermaid/);
});

test('only markdown that contains a mermaid fence requires the svg directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-mermaid-'));
  fs.mkdirSync(path.join(dir, 'posts'));
  fs.writeFileSync(path.join(dir, 'posts', 'plain.md'), 'hello\n');
  assert.equal(contentHasMermaid(dir), false);
  fs.writeFileSync(path.join(dir, 'posts', 'diagram.md'), '```mermaid\ngraph TD\n```\n');
  assert.equal(contentHasMermaid(dir), true);
});
