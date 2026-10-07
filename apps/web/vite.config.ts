import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { developmentPolicy } from './tooling/development-policy.ts';
import { shellManifest } from './tooling/manifest.ts';

export default defineConfig(({ mode }) => {
  // CLI --mode selects the target until the repo owner admits the requested
  // SP_MODE environment lookup without weakening its credential-read rule.
  const target = ['pages', 'e2e-probe', 'review'].includes(mode)
    ? mode
    : 'pages';
  // W5 supplies the separate local-review bundle. Never silently ship the
  // Pages app under a review target before that capability exists.
  if (target === 'review')
    throw new Error('The local-review build is not available yet.');
  return {
    base: '/socialprune/',
    appType: 'mpa',
    plugins: [
      react(),
      developmentPolicy(),
      shellManifest(target === 'e2e-probe' ? 'e2e-probe' : mode),
    ],
    resolve: {
      alias: [
        {
          find: /^@zip\.js\/zip\.js$/,
          replacement: '@zip.js/zip.js/lib/zip-core-native.js',
        },
      ],
    },
    worker: {
      format: 'es',
      rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js' } },
    },
    css: { transformer: 'postcss' },
    build: { cssMinify: 'esbuild' },
  };
});
