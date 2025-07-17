import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind()],
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
  },
});
