import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'adapter-instagram',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
