import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Only headless, disposable generated-page tests. No CLI/profile harness.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/list-freshness.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 30000,
  },
});
