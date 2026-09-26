import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const meta = z.object({
  mid: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
});

const momentImage = z.object({
  src: z.string().min(1),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  alt: z.string().optional(),
  aid: z.number().int().positive().optional(),
});

const commonSchema = z.object({
  kind: z.enum(['post', 'page', 'moment']),
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

const i18nExtension = {
  locale: z.literal('en'),
  sourceCid: z.number().int().positive(),
  sourceRevision: z.number().int().positive(),
  sourcePublishedAt: z.coerce.date(),
  translationVersionId: z.number().int().positive(),
  translationStatus: z.enum(['current', 'outdated']),
  translationAvailableAt: z.coerce.date(),
};

export const collections = {
  posts: defineCollection({
    loader: glob({ base: './src/content/posts', pattern: '**/*.md' }),
    schema: commonSchema.extend({
      kind: z.literal('post'),
      description: z.string().min(24).max(180),
    }),
  }),
  enPosts: defineCollection({
    loader: glob({ base: './src/content/en-posts', pattern: '**/*.md' }),
    schema: commonSchema.extend({
      kind: z.literal('post'),
      description: z.string().min(24).max(180),
      ...i18nExtension,
    }),
  }),
  enPages: defineCollection({
    loader: glob({ base: './src/content/en-pages', pattern: '**/*.md' }),
    schema: commonSchema.extend({ kind: z.literal('page'), ...i18nExtension }),
  }),
  pages: defineCollection({
    loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
    schema: commonSchema.extend({ kind: z.literal('page') }),
  }),
  moments: defineCollection({
    loader: glob({ base: './src/content/moments', pattern: '**/*.md' }),
    schema: commonSchema.extend({
      kind: z.literal('moment'),
      description: z.string().min(8).max(180),
      edited: z.boolean().default(false),
      images: z.array(momentImage).default([]),
      topics: z.array(z.string()).default([]),
      categories: z.array(meta).default([]),
      tags: z.array(meta).default([]),
    }),
  }),
};
