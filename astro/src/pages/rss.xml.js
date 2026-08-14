import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (char) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char],
  );

/** Matches Typecho postsListSize / live RSS fixture window. */
const legacyFeedLimit = 10;

export async function GET(context) {
  const posts = await getCollection('posts', ({ data }) => data.allowFeed);
  const items = posts
    .sort(
      (a, b) =>
        b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
        b.data.legacyCid - a.data.legacyCid,
    )
    .slice(0, legacyFeedLimit)
    .map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      link: post.data.canonicalPath,
      description: post.data.description,
      // @astrojs/rss strips a top-level `guid`; override via customData.
      customData: `<guid isPermaLink="false">${escapeXml(post.data.feedGuid)}</guid>`,
    }));

  return rss({
    title: "AndyYan's Blog",
    description: 'AndyYan 的技术博客',
    site: context.site,
    items,
    xmlns: {
      atom: 'http://www.w3.org/2005/Atom',
    },
    customData: `<language>zh-CN</language>\n<atom:link href="${new URL('/rss.xml', context.site).href}" rel="self" type="application/rss+xml" />`,
  });
}
