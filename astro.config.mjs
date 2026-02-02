// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// Update this to your custom domain
	// When using a custom domain with GitHub Pages, the site is served from root
	site: 'https://example.com',
	
	// With a custom domain, serve from root (no base path needed)
	// If you need to support both custom domain and GitHub Pages subpath, you can
	// use an environment variable: base: import.meta.env.BASE_URL || '/blog/',
	base: '/',
	
	output: 'static',
	integrations: [mdx(), sitemap()],
});
