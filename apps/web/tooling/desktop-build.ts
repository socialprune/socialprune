import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { DESKTOP_POLICY } from '../src/desktop/policy.ts';

export function desktopBuild(): Plugin {
  return {
    name: 'socialprune-desktop',
    apply: 'build',
    config() {
      return {
        build: {
          rollupOptions: {
            input: resolve(import.meta.dirname, '../desktop.html'),
          },
        },
      };
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*("\s*\/>)/,
          `$1${DESKTOP_POLICY}$2`,
        ),
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
            /\/(?:e2e|test)\/|\.test\.|\/src\/(?:import|sw)\/|\/workspace\/(?:idb-store|worker|worker-runtime|registry)|\/local-review\/(?:http-port|session)\./.test(
              id.replaceAll('\\', '/'),
            )
          )
            throw new Error(`Non-desktop module reached desktop output: ${id}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.js',
        source: 'export const buildId="desktop";',
      });
    },
  };
}
