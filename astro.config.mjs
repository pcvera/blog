// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// Update this to your GitHub Pages URL
	// For project pages: 'https://username.github.io/repo-name'
	// For user/org pages: 'https://username.github.io'
	site: 'https://example.com',
	
	// If deploying to a project page (not user/org page), uncomment and set base:
	// base: '/repo-name',
	
	output: 'static',
	outDir: './pages',
	integrations: [mdx(), sitemap()],
});
