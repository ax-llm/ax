import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), react()],
  vite: {
    optimizeDeps: {
      include: ['@ax-llm/ax'],
    },
  },
  markdown: {
    // Use Shiki for consistent highlighting in dev and production
    syntaxHighlight: 'shiki',
    shikiConfig: {
      theme: 'github-light',
      langs: [
        'javascript',
        'typescript',
        'tsx',
        'bash',
        'shell',
        'json',
        'yaml',
        'css',
        'markdown',
        'html',
        'toml',
        'diff',
      ],
      wrap: true,
    },
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          properties: {
            ariaHidden: true,
            tabIndex: -1,
            className: 'anchor-link',
          },
        },
      ],
    ],
  },
});
