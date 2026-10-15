import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-action-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/browser/instagram/network.ts'))
          return null;
        const target = 'if (mutation(request.method(), url.href, name))';
        if (!source.includes(target)) throw new Error('Stale action mutant');
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
