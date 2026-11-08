import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    environment: 'node',
    include: [
      'apps/cli/e2e/placement-runner.test.ts',
      'apps/cli/e2e/occlusion-runner.test.ts',
    ],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 30000,
  },
});
