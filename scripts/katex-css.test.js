import assert from 'node:assert/strict';
import test from 'node:test';
import { rehypeFlagKatex } from '../astro/src/plugins/rehype-flag-katex.js';

function run(tree, file = { data: {} }) {
  rehypeFlagKatex()(tree, file);
  return file;
}

test('flags a katex span', () => {
  const file = run({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['katex'] },
        children: [],
      },
    ],
  });
  assert.equal(file.data.astro.frontmatter.hasKatex, true);
});

test('flags a katex-display wrapper with a string className', () => {
  const file = run({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'div',
        properties: { className: 'katex-display' },
        children: [],
      },
    ],
  });
  assert.equal(file.data.astro.frontmatter.hasKatex, true);
});

test('does not flag unrelated markup', () => {
  const file = run({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: { className: ['prose'] },
        children: [{ type: 'text', value: '$PATH and $HOME' }],
      },
    ],
  });
  assert.equal(file.data.astro.frontmatter.hasKatex, false);
});
