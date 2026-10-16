import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Test-only overly permissive parser: unknown nonempty rows must never vanish.
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c4-row-red',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/instagram/selectors.ts'))
          return null;
        const target =
          "if (!match)\n      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'row-structure');";
        if (!source.includes(target)) throw new Error('Stale C4 row guard');
        return {
          code: source.replace(target, 'if (!match) continue;'),
          map: null,
        };
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
