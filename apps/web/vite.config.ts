import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  css: { transformer: 'postcss' },
  build: { cssMinify: 'esbuild' },
});
