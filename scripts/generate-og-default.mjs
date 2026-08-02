/**
 * Render a plain-text default OG image (1200×630) via Playwright.
 * Used for home / pages that have no Typecho thumb.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'astro', 'public', 'og-default.png');
const { chromium } = createRequire(path.join(ROOT, 'astro', 'package.json'))('playwright');

const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    display: flex; flex-direction: column; justify-content: center;
    padding: 72px 88px; box-sizing: border-box;
    background: #fafafa; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  }
  .brand { font-size: 28px; font-weight: 700; color: #d97706; letter-spacing: -0.02em; }
  h1 { margin: 18px 0 0; font-size: 64px; line-height: 1.15; letter-spacing: -0.03em; max-width: 18ch; }
  p { margin: 22px 0 0; font-size: 28px; color: #6b7280; }
</style></head>
<body>
  <div class="brand">AndyYan</div>
  <h1>AndyYan Blog</h1>
  <p>技术笔记与折腾记录</p>
</body></html>`;

async function main() {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: OUT, type: 'png' });
  } finally {
    await browser.close();
  }
  console.log('wrote', path.relative(ROOT, OUT).replaceAll('\\', '/'));
}

await main();
