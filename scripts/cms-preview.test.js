import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewThemeFromStorage, renderAstroPreview } from './lib/cms-preview-render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('preview theme defaults to light like the public article', () => {
  assert.equal(previewThemeFromStorage(null), 'light');
  assert.equal(previewThemeFromStorage({ getItem: () => 'dark' }), 'dark');
});

test('renders Joe alert/message shortcodes as Astro alert boxes', () => {
  const html = renderAstroPreview(
    '{alert type="info"}提示内容{/alert}\n\n{message type="danger" content="危险"/}',
  );
  assert.match(html, /class="alert alert-info"/);
  assert.match(html, /class="alert alert-danger"/);
  assert.match(html, /提示内容/);
  assert.match(html, /危险/);
  assert.doesNotMatch(html, /joe-alert|joe-message/);
});

test('renders cloud, collapse, bilibili, netease, and task markers', () => {
  const html = renderAstroPreview(
    [
      '{cloud title="备份" url="https://example.com/a.zip"/}',
      '{collapse}{collapse-item label="展开我" close}里面的字{/collapse-item}{/collapse}',
      '{bilibili bvid="BV1xx411c7mD"/}',
      '{netease id="1932349" title="示例歌" artist="示例歌手" cover="https://p1.music.126.net/cover.jpg" note="加班夜循环"/}',
      '{netease id="3434220196"/}',
      '{x} 已完成',
      '{ } 未完成',
    ].join('\n\n'),
  );
  assert.match(html, /class="cloud-card"/);
  assert.match(html, /备份/);
  assert.match(html, /<details class="collapse"/);
  assert.match(html, /bili-embed/);
  assert.match(html, /class="netease-card/);
  assert.match(html, /netease-note/);
  assert.match(html, /加班夜循环/);
  assert.match(html, /示例歌/);
  assert.match(html, /歌曲 3434220196/);
  assert.match(html, /网易云收听/);
  assert.match(html, /站内播放/);
  assert.doesNotMatch(html, /netease-eq|去网易云播放|展开官方播放器/);
  assert.match(html, /netease-embed-panel/);
  assert.match(html, /music\.163\.com\/outchain\/player/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked/);
});

test('inline code uses ap-code so Joe code:not([class]) cannot restyle it', () => {
  const html = renderAstroPreview('使用 `Typecho` 和 `Astro`');
  assert.match(html, /<code class="ap-code">Typecho<\/code>/);
  assert.match(html, /<code class="ap-code">Astro<\/code>/);
});

test('renders katex and mermaid fences without Joe prism language classes', () => {
  const html = renderAstroPreview('行内 $E=mc^2$\n\n```mermaid\ngraph TD; A-->B;\n```\n');
  assert.match(html, /class="katex"/);
  assert.match(html, /class="astro-preview-mermaid"/);
  assert.doesNotMatch(html, /class="language-mermaid"/);
});

test('fixture post with Joe alert still produces Astro markup', () => {
  const source = readFileSync(
    path.join(root, 'astro/src/content/posts/omv-webui-400-bad-request.md'),
    'utf8',
  );
  const body = source.replace(/^---[\s\S]*?---\s*/, '');
  const html = renderAstroPreview(body, { cid: 11 });
  assert.match(html, /class="astro-preview"/);
  assert.match(html, /class="prose"/);
  assert.doesNotMatch(html, /\{alert/);
});
