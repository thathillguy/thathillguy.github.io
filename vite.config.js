import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Source lives in site/ so the built index.html can be published at the repo root
// (GitHub Pages "deploy from a branch" mode) without colliding with the source page.
export default defineConfig({
  root: 'site',
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
