// Explicit browser proof only. The ordinary Node unit project does not run it.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['src/workspace/instagram-owner-migration.proof.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60_000,
  },
});
