import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory =
  // eslint-disable-next-line no-restricted-properties -- Design-only output directory explicitly chosen by the operator, never a credential.
  process.env['SP_FEED_DESIGN_DIR'] ??
  join(tmpdir(), 'socialprune-feed-design');

// Separate entry and output. The three shipping configs never import this file.
export default defineConfig({
  base: '/',
  appType: 'mpa',
  plugins: [react()],
  publicDir: false,
  css: { transformer: 'postcss' },
  build: {
    outDir: join(directory, 'sheet-build'),
    emptyOutDir: true,
    cssMinify: 'esbuild',
    rollupOptions: { input: resolve(import.meta.dirname, 'feed-design.html') },
  },
});
