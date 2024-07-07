import starlight from '@astrojs/starlight';
import tailwind from "@astrojs/tailwind";
import { defineConfig } from 'astro/config';
import { astroImageTools } from "astro-imagetools";


// https://astro.build/config
export default defineConfig({
  base: '/ax/',
  integrations: [astroImageTools, starlight({
    customCss: ["./src/styles/custom.css", "@fontsource/roboto"],
    title: 'Ax',
    social: {
      github: 'https://github.com/ax-llm/ax',
      twitter: 'https://twitter.com/dosco',
      discord: 'https://discord.gg/DSHg3dU7dW'
    },
    sidebar: [{
      label: 'Start Here',
      items: [{
        label: 'Quick Start',
        link: '/start/quick/'
      }, {
        label: 'Supported LLMs',
        link: '/start/llms'
      }, {
        label: 'About Ax',
        link: '/start/about'
      }]
    }, {
      label: 'Guides',
      autogenerate: {
        directory: 'guides'
      }
    }, {
      label: 'API Docs',
      items: [{
        label: 'Classes',
        autogenerate: { directory: 'apidocs/classes'},
        collapsed: true
      }, {
        label: 'Enums',
        autogenerate: { directory: 'apidocs/enums'},
        collapsed: true
      }, {
        label: 'Functions',
        autogenerate: { directory: 'apidocs/functions'},
        collapsed: true
      },{
        label: 'Interfaces',
        autogenerate: { directory: 'apidocs/interfaces'},
        collapsed: true
      }, {
        label: 'Types',
        autogenerate: { directory: 'apidocs/type-aliases'},
        collapsed: true
      },{
        label: 'Variables',
        autogenerate: { directory: 'apidocs/variables'},
        collapsed: true
      }],
    }]
  }), tailwind()]
});