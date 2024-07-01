import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    base: '/ax/',
	integrations: [
		starlight({
            customCss: ["./src/styles/custom.css", "@fontsource-variable/jetbrains-mono", "@fontsource/roboto"],

			title: 'Ax',
			social: {
				github: 'https://github.com/ax-llm/ax',
                twitter: 'https://twitter.com/dosco',
                discord: 'https://discord.gg/DSHg3dU7dW',
			},
			sidebar: [
                {
					label: 'Start Here',
					items: [
						{ label: 'Quick Start', link: '/start/quick/' },
                        { label: 'Supported LLMs', link: '/start/llms' },
                        { label: 'About Ax', link: '/start/about' },
					],
				},
                { 
                    label: 'Guides',
                    autogenerate: { directory: 'guides' },
				},
             	{ 
                    label: 'API Docs',
                    autogenerate: { directory: 'apidocs' },
				},
			],
		}),
	],
});
