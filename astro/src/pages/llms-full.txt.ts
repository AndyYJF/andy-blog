import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { renderLlmsFull, type LlmsPost } from "../lib/llms";

export const prerender = true;

const SITE = "https://www.andy-y.cn";

export const GET: APIRoute = async ({ site }) => {
  const posts = await getCollection("posts", ({ data }) => data.allowFeed);
  const items: LlmsPost[] = posts.map((post) => ({
    title: post.data.title,
    href: post.data.canonicalPath,
    description: post.data.description,
    published: post.data.pubDate.toISOString().slice(0, 10),
    body: post.body,
  }));

  return new Response(renderLlmsFull(site ?? SITE, items), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
