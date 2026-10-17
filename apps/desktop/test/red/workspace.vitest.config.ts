import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'desktop-test-only-erased-open-error',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/cli/src/engine/facade.ts'))
          return;
        const changed = source.replace(
          "if (closing) throw new CliError('NOT_AVAILABLE');",
          "if (closing) throw new CliError('ENGINE_UNAVAILABLE');",
        );
        if (changed === source) throw new Error('RED_MUTATION_NOT_APPLIED');
        return changed;
      },
    },
  ],
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['test/workspace.test.ts'],
    environment: 'node',
    maxWorkers: 2,
  },
});
