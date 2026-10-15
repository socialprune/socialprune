import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-start-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/browser/instagram/run.ts'))
          return null;
        const target = 'if (!(await Promise.race([start, cancelled])))';
        if (!source.includes(target)) throw new Error('Stale Start mutant');
        return { code: source.replace(target, 'if (false)'), map: null };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/context-instagram.test.ts'],
    fileParallelism: false,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
