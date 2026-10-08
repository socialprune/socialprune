import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { LOCAL_REVIEW_POLICY } from '../src/local-review/policy.ts';

export function reviewBuild(): Plugin {
  return {
    name: 'socialprune-local-review',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(
            /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*("\s*\/>)/,
            `$1${LOCAL_REVIEW_POLICY}$2`,
          )
          .replace(/\s*<link rel="manifest"[^>]*>/, '')
          .replace(/\s*<!-- GitHub Pages[\s\S]*?-->/, '')
          .replace('/src/main.tsx', '/src/review-main.tsx');
      },
    },
    resolveId(id) {
      if (id === 'virtual:sp-build-info')
        return { id: '/build-info.js', external: true };
    },
    generateBundle(_options, output) {
      for (const chunk of Object.values(output)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules))
          if (
            /\/(?:workspace\/(?:idb-store|worker|worker-runtime|registry)|import\/|sw\/|app\/(?:gate|demo|updates|trusted-urls))/.test(
              id.replaceAll('\\', '/'),
            )
          )
            throw new Error(
              `Browser-storage or worker module in review build: ${id}`,
            );
      }
      const buildId = createHash('sha256')
        .update(
          JSON.stringify(
            Object.values(output).map((file) => [
              file.fileName,
              file.type === 'chunk' ? file.code : file.source,
            ]),
          ),
        )
        .digest('hex')
        .slice(0, 24);
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.js',
        source: `export const buildId=${JSON.stringify(buildId)};`,
      });
    },
  };
}
