import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Test-only red controls for previously passing journal and extension branches.
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c3-red',
      enforce: 'pre',
      transform(source, id) {
        const path = id.replaceAll('\\', '/');
        const edits: [string, string][] = path.endsWith('/instagram/network.ts')
          ? [
              [
                "fail(new ContextStop('CONTEXT_FAILED', 'request-journal'));",
                'void 0;',
              ],
            ]
          : path.endsWith('/instagram/run.ts')
            ? [
                [
                  'extensionsChanged(before, await profileSnapshot(options.profile))',
                  'extensionsChanged({ ...before, extensionIds: [] }, await profileSnapshot(options.profile))',
                ],
              ]
            : [];
        if (!edits.length) return null;
        for (const [before, after] of edits) {
          if (!source.includes(before)) throw new Error('Stale C3 red control');
          source = source.replace(before, after);
        }
        return { code: source, map: null };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/context-instagram.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
