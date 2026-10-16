import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
