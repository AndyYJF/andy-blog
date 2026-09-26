/**
 * Post-build gate (manifest-driven).
 *
 * A mermaid diagram that fails to render (e.g. Playwright cannot launch a browser)
 * makes @beoe/rehype-mermaid drop the *entire* document without any build error,
 * so a page can silently ship with an empty body. This gate compares every source
 * document against its rendered output and fails loudly on mismatches.
 *
 * Since the i18n work, URLs are no longer guessed from directory names:
 * sync-typecho writes astro/.cache/zh-manifest.json (every zh document's
 * sourceFile → outputFile) and astro/.cache/i18n-selection.json (localized
 * output identities, docs/i18n-p2-design-2026-09-26.md §5). Entries marked
 * render-rejected must NOT have output — producing one means isolation broke.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO = path.join(ROOT, 'astro');
const DIST = path.join(ASTRO, 'dist');
const CACHE = path.join(ASTRO, '.cache');

const MIN_BODY_CHARS = 40;
// Markdown loses syntax characters on render, so compare against a generous fraction.
const MIN_RENDERED_RATIO = 0.25;

const stripFrontmatter = (text) => {
  const end = text.indexOf('\n---\n', 3);
  return end === -1 ? text : text.slice(end + 5);
};

const articleBody = (html) => {
  const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html);
  if (!article) return null;
  return article[1].replace(/<header class="entry-header">[\s\S]*?<\/header>/, '');
};

const loadJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const main = async () => {
  const failures = [];
  const zhManifest = loadJson(path.join(CACHE, 'zh-manifest.json'));
  const selection = loadJson(path.join(CACHE, 'i18n-selection.json'));

  /** Shared per-document checks. label identifies the doc in failure messages. */
  const checkDoc = ({ label, sourceFile, outputFile }) => {
    const sourceAbs = path.join(ASTRO, sourceFile);
    if (!existsSync(sourceAbs)) {
      failures.push(`${label}: 源文件缺失 ${sourceFile}`);
      return;
    }
    const source = readFileSync(sourceAbs, 'utf8');
    const body = stripFrontmatter(source).replace(/\s+/g, ' ').trim();

    const outAbs = path.join(DIST, outputFile);
    if (!existsSync(outAbs)) {
      failures.push(`${label}: 未生成 ${outputFile}`);
      return;
    }

    const html = readFileSync(outAbs, 'utf8');
    const rendered = articleBody(html);
    if (rendered === null) {
      failures.push(`${label}: 输出缺少 <article>`);
      return;
    }

    const renderedText = rendered
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body.length >= MIN_BODY_CHARS && renderedText.length < body.length * MIN_RENDERED_RATIO) {
      failures.push(
        `${label}: 正文 ${body.length} 字符，渲染后正文仅 ${renderedText.length} 字符（疑似整篇被丢弃）`,
      );
    }

    // Fences may be indented inside lists; Astro still renders those as mermaid.
    const diagrams = (stripFrontmatter(source).match(/^[ \t]*```mermaid\b/gm) ?? []).length;
    const rendered_diagrams = (rendered.match(/beoe-light/g) ?? []).length;
    if (diagrams !== rendered_diagrams) {
      failures.push(
        `${label}: mermaid 图 ${diagrams} 张，产物中 ${rendered_diagrams} 张`,
      );
    }
    const beoeSrcs = [...rendered.matchAll(/src="(\/beoe\/[^"]+)"/g)].map((match) => match[1]);
    for (const src of beoeSrcs) {
      const file = path.join(DIST, src.replace(/^\//, ''));
      if (!existsSync(file)) {
        failures.push(`${label}: mermaid 产物缺失 ${src}`);
      }
    }
  };

  let checked = 0;
  for (const entry of zhManifest.entries) {
    checkDoc({
      label: `${entry.collection}/${entry.slug}`,
      sourceFile: entry.sourceFile,
      outputFile: entry.outputFile,
    });
    checked += 1;
  }

  let localizedChecked = 0;
  for (const entry of selection.entries || []) {
    if (entry.translationStatus === 'render-rejected') {
      if (entry.outputFile && existsSync(path.join(DIST, entry.outputFile))) {
        failures.push(
          `${entry.entryKey}: render-rejected 条目却生成了 ${entry.outputFile}（隔离失效）`,
        );
      }
      continue;
    }
    if (!entry.renderExpected) continue;
    checkDoc({
      label: entry.entryKey,
      sourceFile: entry.sourceFile,
      outputFile: entry.outputFile,
    });
    localizedChecked += 1;
  }

  const checkedFixture = readFileSync(
    path.join(DIST, 'posts', 'asterisk-telephony42', 'index.html'),
    'utf8',
  );
  const checkedInputs = checkedFixture.match(/<input type="checkbox" checked disabled>/g) ?? [];
  if (!checkedFixture.includes('class="contains-task-list"') || checkedInputs.length !== 3) {
    failures.push('posts/asterisk-telephony42: Joe checked tasks did not render as 3 disabled checkboxes');
  }

  const mixedFixture = readFileSync(
    path.join(DIST, 'posts', 'silly-tavern-linux', 'index.html'),
    'utf8',
  );
  if (!mixedFixture.includes('<input type="checkbox" disabled>')) {
    failures.push('posts/silly-tavern-linux: Joe unchecked task did not render as a disabled checkbox');
  }
  const checkedArticle = articleBody(checkedFixture) ?? '';
  const mixedArticle = articleBody(mixedFixture) ?? '';
  if (/\{(?:x|X| )\}/u.test(checkedArticle) || /\{(?:x|X| )\}/u.test(mixedArticle)) {
    failures.push('Joe task marker remained visible in rendered article HTML');
  }

  if (failures.length > 0) {
    console.error('渲染门禁未通过：');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('\n提示：mermaid 需要可用的 Playwright Chromium，检查 PLAYWRIGHT_BROWSERS_PATH。');
    process.exit(1);
  }

  console.log(
    `渲染门禁通过：${checked} 篇中文文档 + ${localizedChecked} 条英文条目，正文与 mermaid 产物均完整。`,
  );
};

await main();
