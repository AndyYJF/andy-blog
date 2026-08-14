// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeMermaid from '@beoe/rehype-mermaid';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { remarkCustomDirectives } from './src/plugins/remark-directives.js';
import { remarkImageSize } from './src/plugins/remark-image-size.js';
import { rehypeDiagramImages } from './src/plugins/rehype-diagram-images.js';
import { rehypeFlagKatex } from './src/plugins/rehype-flag-katex.js';

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
  integrations: [
    expressiveCode({
      themes: ['github-light', 'github-dark'],
      useDarkModeMediaQuery: false,
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
        rehypeKatex,
        rehypeFlagKatex,
        [
          rehypeMermaid,
          {
            strategy: 'file',
            fsPath: 'public/beoe',
            webPath: '/beoe',
            darkScheme: 'class',
          },
        ],
        rehypeDiagramImages,
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            behavior: 'append',
            content: { type: 'text', value: '#' },
            properties: { className: ['anchor'], ariaLabel: '本节锚点' },
          },
        ],
      ],
    }),
  },
});
