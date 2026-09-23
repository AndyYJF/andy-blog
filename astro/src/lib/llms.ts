/**
 * llmstxt.org index for the static site.
 * Index stays a link list; full text lives in llms-full.txt.
 * Moments are an entry link only — their bodies are not syndicated here.
 */

export type LlmsPost = {
  title: string;
  href: string;
  description?: string;
  published: string;
  body?: string;
};

const SITE_TITLE = "AndyYan Blog";
const SITE_SUMMARY =
  "AndyYan 的个人技术账本，记录 VPS、BGP/DN42 和自托管运维。公开文章在构建时生成 HTML，可直接阅读。";

export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Link labels cannot contain raw brackets; collapse whitespace first. */
export function markdownLinkLabel(title: string): string {
  return oneLine(title).replace(/\\/g, "").replace(/[\[\]]/g, "");
}

export function absoluteUrl(site: URL | string, pathname: string): string {
  return new URL(pathname, site).href;
}

function bullet(title: string, href: string, note?: string): string {
  const label = markdownLinkLabel(title);
  const detail = note ? `: ${oneLine(note)}` : "";
  return `- [${label}](${href})${detail}`;
}

function sortedPosts(posts: LlmsPost[]): LlmsPost[] {
  return [...posts].sort((a, b) => {
    const byDate = b.published.localeCompare(a.published);
    if (byDate !== 0) return byDate;
    return a.href.localeCompare(b.href);
  });
}

export function renderLlmsIndex(site: URL | string, posts: LlmsPost[]): string {
  const origin = new URL(site);
  const lines = [
    `# ${SITE_TITLE}`,
    "",
    `> ${SITE_SUMMARY}`,
    "",
    "权威地址是 https://www.andy-y.cn/。评论依赖浏览器加载，不包含在这份目录里。",
    "",
    "## 入口",
    "",
    bullet("首页", absoluteUrl(origin, "/"), "网络实践、自托管项目与技术文章"),
    bullet("文章", absoluteUrl(origin, "/posts/"), "技术笔记列表"),
    bullet("归档", absoluteUrl(origin, "/archive/")),
    bullet("DN42", absoluteUrl(origin, "/dn42/"), "ASN 4242422921，洛杉矶、法兰克福、香港、东京"),
    bullet("关于", absoluteUrl(origin, "/about/")),
    bullet("友链", absoluteUrl(origin, "/friends/")),
    bullet("闲话", absoluteUrl(origin, "/moments/"), "近况短记，正文不收入本目录"),
    "",
    "## 订阅",
    "",
    bullet("完整正文", absoluteUrl(origin, "/llms-full.txt"), "全部公开文章的 Markdown"),
    bullet("RSS", absoluteUrl(origin, "/rss.xml")),
    bullet("闲话 RSS", absoluteUrl(origin, "/moments/rss.xml")),
    bullet("站点地图", absoluteUrl(origin, "/sitemap-index.xml")),
    "",
    "## 文章",
    "",
  ];

  const items = sortedPosts(posts);
  if (items.length === 0) {
    lines.push("暂无公开文章。");
  } else {
    for (const post of items) {
      lines.push(bullet(post.title, absoluteUrl(origin, post.href), post.description));
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderLlmsFull(site: URL | string, posts: LlmsPost[]): string {
  const origin = new URL(site);
  const lines = [
    `# ${SITE_TITLE}`,
    "",
    `> ${SITE_SUMMARY}`,
    "",
    `索引：${absoluteUrl(origin, "/llms.txt")}`,
    "",
  ];

  const items = sortedPosts(posts);
  if (items.length === 0) {
    lines.push("暂无公开文章。", "");
    return `${lines.join("\n")}\n`;
  }

  for (const post of items) {
    lines.push(
      `## ${oneLine(post.title)}`,
      "",
      `- URL: ${absoluteUrl(origin, post.href)}`,
      `- 发布: ${post.published}`,
    );
    if (post.description) lines.push(`- 摘要: ${oneLine(post.description)}`);
    lines.push("");
    const body = post.body?.trim();
    if (body) {
      lines.push(body, "");
    }
  }

  return `${lines.join("\n")}\n`;
}
