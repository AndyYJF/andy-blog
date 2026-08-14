import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const meta = z.object({
  mid: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
});

const commonSchema = z.object({
  kind: z.enum(['post', 'page']),
  title: z.string(),
  legacyCid: z.number().int().positive(),
  canonicalPath: z.string().startsWith('/').endsWith('/'),
  commentKey: z.string().startsWith('/'),
  feedGuid: z.string().min(1),
  allowComment: z.boolean(),
  allowFeed: z.boolean(),
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  categories: z.array(meta).default([]),
  primaryCategoryMid: z.number().int().positive().optional(),
  tags: z.array(meta).default([]),
  description: z.string().min(24).max(180).optional(),
  cover: z.string().optional(),
  sourceFormat: z.enum(['markdown', 'html']),
});

export const collections = {
  posts: defineCollection({
    loader: glob({ base: './src/content/posts', pattern: '**/*.md' }),
    schema: commonSchema.extend({
      kind: z.literal('post'),
      description: z.string().min(24).max(180),
    }),
  }),
  pages: defineCollection({
    loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
    schema: commonSchema.extend({ kind: z.literal('page') }),
  }),
};
