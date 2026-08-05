import { visit } from 'unist-util-visit';

export function rehypeDiagramImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img') return;
      const raw = node.properties?.className ?? [];
      const classes = Array.isArray(raw) ? raw.map(String) : String(raw).split(/\s+/).filter(Boolean);
      if (!classes.some((name) => name === 'beoe-light' || name === 'beoe-dark')) return;
      const label = classes.includes('beoe-dark')
        ? 'Mermaid diagram (dark theme)'
        : 'Mermaid diagram (light theme)';
      node.properties = {
        ...node.properties,
        loading: 'lazy',
        decoding: 'async',
        alt: label,
        ariaLabel: label,
      };
    });
  };
}
