import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lead: z.string(),
    keywords: z.string(),
    kicker: z.string(),
    ogDescription: z.string(),
    publishDate: z.coerce.date(),
    readingTime: z.string(),
    tags: z.array(z.string()).default([]),
    next: z.string().optional(),
    wordCount: z.number().optional(),
  }),
});

export const collections = { blog };
