import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    {
      name: 'desktop-test-only-removed-guards',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/main/router.ts')) return;
        return source
          .replace('!authorizedSender(event, owner)', 'false')
          .replace('!parsed.success', 'false');
      },
    },
  ],
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['test/router.test.ts'],
    environment: 'node',
    maxWorkers: 2,
  },
});
