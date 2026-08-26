import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryTone } from '../astro/src/lib/category-tone.ts';

test('known network slugs keep the amber accent tone', () => {
  assert.equal(categoryTone('refine'), 'accent');
  assert.equal(categoryTone('mnt'), 'accent');
});

test('Astro joins the site/open-source cyan list', () => {
  assert.equal(categoryTone('astro'), 'cyan');
  assert.equal(categoryTone('Astro'), 'cyan');
  assert.equal(categoryTone('opensource'), 'cyan');
  assert.equal(`tone-${categoryTone('astro')}`, 'tone-cyan');
});

test('unknown categories stay untoned', () => {
  assert.equal(categoryTone('review'), null);
  assert.equal(categoryTone(undefined), null);
});
