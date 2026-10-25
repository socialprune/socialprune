import type { Plugin } from 'vite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
/** This build mode substitutes test probes only. Normal/review/desktop builds
 * never import these modules or read a runtime diagnostic flag. */
export function frameAttributionBuild(mode: string): Plugin {
  const enabled = mode === 'e2e-frame';
  return {
    name: 'socialprune-test-frame-attribution',
    enforce: 'pre',
    transformIndexHtml(html) {
      return enabled
        ? html.replace('/src/main.tsx', '/test/probes/frame-entry.tsx')
        : html;
    },
    resolveId(source, importer) {
      if (!enabled || !importer) return;
      if (
        importer
          .replaceAll('\\', '/')
          .endsWith('/src/review/feed/ReviewFeed.tsx') &&
        source === '@tanstack/react-virtual'
      )
        return require.resolve('../test/probes/frame-virtualizer.ts');
      if (
        importer
          .replaceAll('\\', '/')
          .endsWith('/src/review/feed/FeedWorkspace.tsx') &&
        source === './session.ts'
      )
        return require.resolve('../test/probes/frame-session.ts');
    },
  };
}
