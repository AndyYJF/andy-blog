// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import { pluginFramesTexts } from '@expressive-code/plugin-frames';
import { createMarkdownProcessor } from './src/lib/markdown-pipeline.mjs';

pluginFramesTexts.addLocale('zh-CN', {
  copyButtonTooltip: '复制',
  copyButtonCopied: '已复制',
});

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
        if (pathname === '/en/rss.xml') return false;
        if (pathname === '/moments/rss.xml') return false;
        if (pathname === '/llms.txt' || pathname === '/llms-full.txt') return false;
        if (pathname === '/en/llms.txt') return false;
        if (pathname === '/404.html' || pathname === '/404/') return false;
        if (pathname === '/linuxdo/' || pathname === '/linuxdo') return false;
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
    processor: createMarkdownProcessor(),
  },
});
