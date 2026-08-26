import { visit } from 'unist-util-visit';

/**
 * Demote markdown-body h1 elements to h2.
 * Leaves h2–h6 unchanged so correctly structured posts keep TOC-friendly h2s,
 * and mixed posts only fix stray Typecho-synced `#` headings.
 */
export function rehypeDemoteH1() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'h1') {
        node.tagName = 'h2';
      }
    });
  };
}
