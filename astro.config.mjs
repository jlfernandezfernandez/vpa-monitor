// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://jlfernandezfernandez.github.io',
  base: '/vivienda-coruna',
  vite: { plugins: [tailwindcss()] },
});
