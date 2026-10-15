import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c2-interval-red',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/instagram/pace.ts'))
          return null;
        const before = ': order.value.secondsPerStep * 1000';
        if (!source.includes(before))
          throw new Error('Stale C2 interval control');
        return { code: source.replace(before, ': 1000'), map: null };
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
