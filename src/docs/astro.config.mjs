import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), react()],
  markdown: {
    // Use Shiki for better syntax highlighting performance
    syntaxHighlight: 'shiki',
    shikiConfig: {
      theme: 'github-light',
      // Add more languages as needed
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
