import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { developmentPolicy } from './tooling/development-policy.ts';
import { shellManifest } from './tooling/manifest.ts';
import { demoBytes } from './tooling/demo-bytes.ts';
import { reviewBuild } from './tooling/review-build.ts';

export default defineConfig(({ mode }) => {
  // Build targets use Vite --mode only. No environment-variable lookup is
  // needed; the matching runtime value is import.meta.env.MODE.
  const target = ['pages', 'e2e-probe', 'review'].includes(mode)
    ? mode
    : 'pages';
  const review = target === 'review';
  return {
    base: review ? '/' : '/socialprune/',
    appType: 'mpa',
    plugins: [
      react(),
      ...(review
        ? [reviewBuild()]
        : [
            developmentPolicy(),
            demoBytes(),
            shellManifest(target === 'e2e-probe' ? 'e2e-probe' : mode),
          ]),
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
      plugins: () => [demoBytes()],
      rollupOptions: {
        output: {
          entryFileNames: (chunk) =>
            chunk.facadeModuleId?.includes('/workspace/')
              ? 'assets/workspace-worker-[hash].js'
              : 'assets/[name]-[hash].js',
        },
      },
    },
    css: { transformer: 'postcss' },
    publicDir: review ? false : 'public',
    build: {
      cssMinify: 'esbuild',
      ...(review ? { outDir: 'dist-review' } : {}),
    },
  };
});
