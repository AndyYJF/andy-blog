import { visit } from 'unist-util-visit';

export function rehypeDiagramImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img') return;
      const raw = node.properties?.className ?? [];
      const classes = Array.isArray(raw) ? raw.map(String) : String(raw).split(/\s+/);
      if (!classes.some((name) => name === 'beoe-light' || name === 'beoe-dark')) return;
      node.properties.loading = 'lazy';
      node.properties.decoding = 'async';
    });
  };
}
