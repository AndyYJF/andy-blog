import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { renderLlmsIndex, type LlmsPost } from "../../lib/llms";

export const prerender = true;

const SITE = "https://www.andy-y.cn";

export const GET: APIRoute = async ({ site }) => {
  const posts = await getCollection("enPosts", ({ data }) => data.allowFeed);
  const items: LlmsPost[] = posts.map((post) => ({
    title: post.data.title,
    href: post.data.canonicalPath,
    description: post.data.description,
    published: post.data.pubDate.toISOString().slice(0, 10),
  }));

  return new Response(
    renderLlmsIndex(site ?? SITE, items, {
      summary:
        "AndyYan's personal tech notebook: VPS, BGP/DN42 and self-hosting operations. These are English translations of the Chinese originals.",
      authority:
        "Canonical site: https://www.andy-y.cn/en/. The Chinese original at https://www.andy-y.cn/ is authoritative. Comments require a browser and are not included here.",
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
};
