import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const collections = {
	docs: defineCollection({ schema: docsSchema() }),
};
