import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// User site served from the domain root, so base stays '/'.
export default defineConfig({
  plugins: [react()],
  base: '/',
});
