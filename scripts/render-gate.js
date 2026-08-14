/**
 * Post-build gate.
 *
 * A mermaid diagram that fails to render (e.g. Playwright cannot launch a browser)
 * makes @beoe/rehype-mermaid drop the *entire* document without any build error,
 * so a page can silently ship with an empty body. This gate compares every source
 * document against its rendered output and fails loudly on mismatches.
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'astro', 'src', 'content');
const DIST = path.join(ROOT, 'astro', 'dist');

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

const listMarkdown = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdown(full)));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
};

const main = async () => {
  const failures = [];
  const files = await listMarkdown(CONTENT);

  for (const file of files.sort()) {
    const slug = path.basename(file, '.md');
    const collection = path.basename(path.dirname(file));
    const source = readFileSync(file, 'utf8');
    const body = stripFrontmatter(source).replace(/\s+/g, ' ').trim();

    const outDir = collection === 'posts' ? path.join(DIST, 'posts', slug) : path.join(DIST, slug);
    const outFile = path.join(outDir, 'index.html');
    if (!existsSync(outFile)) {
      failures.push(`${collection}/${slug}: 未生成 ${path.relative(ROOT, outFile)}`);
      continue;
    }

    const html = readFileSync(outFile, 'utf8');
    const rendered = articleBody(html);
    if (rendered === null) {
      failures.push(`${collection}/${slug}: 输出缺少 <article>`);
      continue;
    }

    const renderedText = rendered
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body.length >= MIN_BODY_CHARS && renderedText.length < body.length * MIN_RENDERED_RATIO) {
      failures.push(
        `${collection}/${slug}: 正文 ${body.length} 字符，渲染后正文仅 ${renderedText.length} 字符（疑似整篇被丢弃）`,
      );
    }

    const diagrams = (stripFrontmatter(source).match(/^```mermaid/gm) ?? []).length;
    const rendered_diagrams = (rendered.match(/beoe-light/g) ?? []).length;
    if (diagrams !== rendered_diagrams) {
      failures.push(
        `${collection}/${slug}: mermaid 图 ${diagrams} 张，产物中 ${rendered_diagrams} 张`,
      );
    }
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
  if (/\{(?:x|X| )\}/u.test(checkedFixture) || /\{(?:x|X| )\}/u.test(mixedFixture)) {
    failures.push('Joe task marker remained visible in rendered article HTML');
  }

  if (failures.length > 0) {
    console.error('渲染门禁未通过：');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('\n提示：mermaid 需要可用的 Playwright Chromium，检查 PLAYWRIGHT_BROWSERS_PATH。');
    process.exit(1);
  }

  console.log(`渲染门禁通过：${files.length} 篇文档，正文与 mermaid 产物均完整。`);
};

await main();
