/**
 * Shared markdown pipeline — the single source of truth for how CMS markdown
 * becomes HTML. astro.config.mjs builds the site with it and
 * scripts/prerender-en.js validates English entries with the identical
 * processor, which is what makes prerender verdicts meaningful.
 *
 * Anything that changes rendering output must change here (or in
 * src/plugins/*), so rendererFingerprint (scripts/lib/i18n-fingerprint.js)
 * covers this file.
 */
import { unified } from '@astrojs/markdown-remark';
import { readFileSync } from 'node:fs';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeMermaid from '@beoe/rehype-mermaid';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { toString } from 'hast-util-to-string';
import { remarkCustomDirectives } from '../plugins/remark-directives.js';
import { remarkImageSize } from '../plugins/remark-image-size.js';
import { rehypeDiagramImages } from '../plugins/rehype-diagram-images.js';
import { rehypeDemoteH1 } from '../plugins/rehype-demote-h1.js';
import { rehypeFlagKatex } from '../plugins/rehype-flag-katex.js';
import { rehypeWrapTables } from '../plugins/rehype-wrap-tables.js';
import { createBeoeCache } from './beoe-cache.js';

const beoeMermaidPkg = JSON.parse(
  readFileSync(new URL('../../node_modules/@beoe/rehype-mermaid/package.json', import.meta.url), 'utf8'),
);

/** Drop prior definitions for a property so a later unrestricted entry wins. */
function withoutProp(list = [], name) {
  return list.filter((entry) => (Array.isArray(entry) ? entry[0] : entry) !== name);
}

const svgPresentation = [
  'fill',
  'stroke',
  'strokeWidth',
  'strokeLineCap',
  'strokeLineJoin',
];

/** Allowlist for CMS/directive HTML after rehypeRaw; katex/mermaid run after this. */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'svg',
    'path',
    'g',
    'circle',
    'rect',
    'iframe',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className'],
    a: [...withoutProp(defaultSchema.attributes?.a, 'className'), 'className', 'rel', 'target'],
    img: [
      ...withoutProp(defaultSchema.attributes?.img, 'className'),
      'className',
      'loading',
      'decoding',
    ],
    iframe: ['src', 'className', 'loading', 'allowFullScreen', 'title'],
    svg: ['viewBox', 'ariaHidden', 'className', 'width', 'height', ...svgPresentation],
    path: ['d', ...svgPresentation],
    g: [...svgPresentation],
    circle: ['cx', 'cy', 'r', ...svgPresentation],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...svgPresentation],
    div: [...withoutProp(defaultSchema.attributes?.div, 'className'), 'className', 'role'],
    details: ['className', 'open'],
    summary: [...withoutProp(defaultSchema.attributes?.summary, 'className'), 'className'],
    span: ['className'],
    pre: ['className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

export const markdownRemarkPlugins = [
  remarkMath,
  remarkDirective,
  remarkCustomDirectives,
  remarkImageSize,
];

export const markdownRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeKatex,
  rehypeFlagKatex,
  [
    rehypeMermaid,
    {
      strategy: 'file',
      fsPath: 'public/beoe',
      webPath: '/beoe',
      darkScheme: 'class',
      cache: createBeoeCache(),
      // Lands in Beoe salt via defaults; bust cache on plugin upgrades.
      _cacheVersion: beoeMermaidPkg.version,
    },
  ],
  rehypeDiagramImages,
  rehypeDemoteH1,
  rehypeWrapTables,
  rehypeSlug,
  [
    rehypeAutolinkHeadings,
    {
      behavior: 'append',
      content: { type: 'text', value: '#' },
      properties: (node) => ({
        className: ['anchor'],
        ariaLabel: `链接到「${toString(node)}」`,
      }),
    },
  ],
];

export function createMarkdownProcessor() {
  return unified({
    remarkPlugins: markdownRemarkPlugins,
    rehypePlugins: markdownRehypePlugins,
  });
}

/**
 * Render markdown through the real Astro markdown processor configured with
 * the shared plugin arrays. Used by scripts/prerender-en.js; astro.config
 * uses the carrier above. Defaults are spread first so behavior matches how
 * Astro merges markdown.processor over markdownConfigDefaults.
 */
let realProcessor = null;
export async function renderWithSharedPipeline(markdown) {
  if (!realProcessor) {
    const { createMarkdownProcessor: createReal, markdownConfigDefaults } = await import('@astrojs/markdown-remark');
    realProcessor = await createReal({
      ...markdownConfigDefaults,
      remarkPlugins: markdownRemarkPlugins,
      rehypePlugins: markdownRehypePlugins,
    });
  }
  const result = await realProcessor.render(markdown);
  return result.code;
}

// withoutProp is part of the original astro.config helper set; re-exported so
// the config keeps compiling unchanged if it references it.
export { withoutProp };
