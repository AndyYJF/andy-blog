// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import { pluginFramesTexts } from '@expressive-code/plugin-frames';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeMermaid from '@beoe/rehype-mermaid';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { toString } from 'hast-util-to-string';
import { remarkCustomDirectives } from './src/plugins/remark-directives.js';
import { remarkImageSize } from './src/plugins/remark-image-size.js';
import { rehypeDiagramImages } from './src/plugins/rehype-diagram-images.js';
import { rehypeDemoteH1 } from './src/plugins/rehype-demote-h1.js';
import { rehypeFlagKatex } from './src/plugins/rehype-flag-katex.js';
import { rehypeWrapTables } from './src/plugins/rehype-wrap-tables.js';
import { createBeoeCache } from './src/lib/beoe-cache.js';

const beoeMermaidPkg = JSON.parse(
  readFileSync(new URL('./node_modules/@beoe/rehype-mermaid/package.json', import.meta.url), 'utf8'),
);

pluginFramesTexts.addLocale('zh-CN', {
  copyButtonTooltip: '复制',
  copyButtonCopied: '已复制',
});

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
const markdownSanitizeSchema = {
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @type {Record<string, string>} */
let lastmodByPath = {};
const sitemapExclude = new Set();
try {
  lastmodByPath = JSON.parse(readFileSync(path.join(root, 'data', 'lastmod.json'), 'utf8'));
} catch {
  lastmodByPath = {};
}
try {
  const manifest = JSON.parse(readFileSync(path.join(root, 'astro', '.cache', 'manifest.json'), 'utf8'));
  for (const pathname of manifest.sitemapExclude || []) sitemapExclude.add(pathname);
} catch {
  // First config load before sync: no exclusions are known yet.
}

export default defineConfig({
  site: 'https://www.andy-y.cn',
  trailingSlash: 'always',
  redirects: {
    '/archives': '/archive/',
    '/archives/': '/archive/',
  },
  vite: {
    build: {
      cssTarget: ['chrome111', 'firefox128', 'safari16.4', 'edge111'],
    },
  },
  integrations: [
    expressiveCode({
      themes: ['github-light', 'github-dark'],
      useDarkModeMediaQuery: false,
      defaultLocale: 'zh-CN',
      themeCssSelector: (theme) =>
        theme.name === 'github-dark'
          ? "[data-theme='dark']"
          : "[data-theme='light']",
      styleOverrides: {
        borderRadius: '6px',
        borderWidth: '1px',
        uiFontFamily: 'var(--font-sans)',
        codeFontFamily: 'var(--font-mono)',
        frames: {
          inlineButtonBackgroundIdleOpacity: '0.1',
          inlineButtonBackgroundHoverOrFocusOpacity: '0.2',
          inlineButtonBackgroundActiveOpacity: '0.3',
        },
      },
      defaultProps: { wrap: true },
    }),
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        if (pathname === '/rss.xml') return false;
        if (pathname === '/moments/rss.xml') return false;
        if (pathname === '/llms.txt' || pathname === '/llms-full.txt') return false;
        if (pathname === '/404.html' || pathname === '/404/') return false;
        if (sitemapExclude.has(pathname)) return false;
        return true;
      },
      serialize(item) {
        const pathname = new URL(item.url).pathname;
        const lastmod = lastmodByPath[pathname];
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [
        remarkMath,
        remarkDirective,
        remarkCustomDirectives,
        remarkImageSize,
      ],
      rehypePlugins: [
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
      ],
    }),
  },
});
