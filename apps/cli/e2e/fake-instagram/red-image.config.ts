import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-image-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/browser/instagram/capture.ts'))
          return null;
        const target =
          'const response =\n    source && policy.image(source) ? images.get(source) : undefined;';
        if (!source.includes(target)) throw new Error('Stale image mutant');
        return {
          code: source.replace(
            target,
            'if (source) await element.page().request.get(source); ' + target,
          ),
          map: null,
        };
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
