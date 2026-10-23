import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'classify',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    maxWorkers: 1,
  },
});
