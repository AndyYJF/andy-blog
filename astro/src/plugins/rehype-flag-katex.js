import { visit } from 'unist-util-visit';

function classNames(node) {
  const raw = node.properties?.className;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw).split(/\s+/).filter(Boolean);
}

function isKatexClass(name) {
  return name === 'katex' || name === 'katex-display';
}

export function rehypeFlagKatex() {
  return (tree, file) => {
    let hasKatex = false;
    visit(tree, 'element', (node) => {
      if (hasKatex) return;
      if (classNames(node).some(isKatexClass)) hasKatex = true;
    });
    const astro = (file.data.astro ??= {});
    const frontmatter = (astro.frontmatter ??= {});
    frontmatter.hasKatex = hasKatex;
  };
}
