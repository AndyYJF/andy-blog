import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (char) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char],
  );

export async function GET(context) {
  const moments = await getCollection('moments', ({ data }) => data.allowFeed);
  const items = moments
    .sort(
      (a, b) =>
        b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
        b.data.legacyCid - a.data.legacyCid,
    )
    .slice(0, 20)
    .map((moment) => ({
      title: moment.data.title,
      pubDate: moment.data.pubDate,
      link: moment.data.canonicalPath,
      description: moment.data.description,
      customData: `<guid isPermaLink="false">${escapeXml(moment.data.feedGuid)}</guid>`,
    }));

  return rss({
    title: "AndyYan 的闲话",
    description: '一些近况、随手拍，以及还没写成文章的想法。',
    site: context.site,
    items,
    xmlns: {
      atom: 'http://www.w3.org/2005/Atom',
    },
    customData: `<language>zh-CN</language>\n<atom:link href="${new URL('/moments/rss.xml', context.site).href}" rel="self" type="application/rss+xml" />`,
  });
}
