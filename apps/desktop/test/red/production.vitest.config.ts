import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    {
      name: 'desktop-test-only-removed-bundle-guard',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/packaging/boundary.ts'))
          return;
        const changed = source.replace(
          /throw new Error\(["']PRODUCTION_TEST_IMPORT["']\)/,
          'return',
        );
        if (source === changed) throw new Error('RED_MUTATION_NOT_APPLIED');
        return changed;
      },
    },
  ],
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['test/production-bundle.test.ts'],
    environment: 'node',
    maxWorkers: 2,
  },
});
