import assert from "node:assert/strict";
import test from "node:test";
import { markdownLinkLabel, renderLlmsFull, renderLlmsIndex } from "../astro/src/lib/llms.ts";

const site = "https://www.andy-y.cn";

const posts = [
  {
    title: "较新的 [笔记]",
    href: "/posts/newer/",
    description: "第一行\n第二行",
    published: "2026-09-01",
    body: "正文甲",
  },
  {
    title: "较早的笔记",
    href: "/posts/older/",
    description: "旧摘要",
    published: "2026-01-02",
    body: "正文乙",
  },
];

test("link labels drop brackets that would break markdown", () => {
  assert.equal(markdownLinkLabel(" 较新的 [笔记] \n"), "较新的 笔记");
});

test("index lists public posts newest first and keeps moments out of the catalog", () => {
  const text = renderLlmsIndex(site, posts);
  assert.match(text, /^# AndyYan Blog\n/);
  assert.match(text, /> AndyYan 的个人技术账本/);
  assert.ok(text.includes("[完整正文](https://www.andy-y.cn/llms-full.txt)"));
  assert.ok(text.includes("[闲话](https://www.andy-y.cn/moments/)"));
  assert.equal(text.includes("/moments/9001/"), false);
  const newer = text.indexOf("/posts/newer/");
  const older = text.indexOf("/posts/older/");
  assert.ok(newer > 0 && older > newer);
  assert.match(text, /\[较新的 笔记\]\(https:\/\/www\.andy-y\.cn\/posts\/newer\/\): 第一行 第二行/);
  assert.equal(text.endsWith("\n"), true);
});

test("full text keeps each article body under its canonical URL", () => {
  const text = renderLlmsFull(site, [posts[1]]);
  assert.match(text, /## 较早的笔记\n\n- URL: https:\/\/www\.andy-y\.cn\/posts\/older\/\n- 发布: 2026-01-02\n- 摘要: 旧摘要\n\n正文乙\n/);
  assert.ok(text.includes("https://www.andy-y.cn/llms.txt"));
  assert.equal(text.includes("正文甲"), false);
});

test("empty catalogs stay valid and do not invent articles", () => {
  const index = renderLlmsIndex(site, []);
  const full = renderLlmsFull(site, []);
  assert.match(index, /## 文章\n\n暂无公开文章。\n$/);
  assert.match(full, /暂无公开文章。\n+$/);
  assert.equal(index.includes("/posts/newer/"), false);
});
