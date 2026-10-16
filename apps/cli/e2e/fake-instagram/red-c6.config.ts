import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Explicit test entry only. Production has no environment-driven mutation path.
// eslint-disable-next-line no-restricted-properties -- Node red-control selection only.
const mode = process.env.SP_CONTEXT_RED_MODE;
if (mode !== undefined && mode !== 'probe-wait')
  throw new Error('Choose an explicit C6 red control.');
const enginePace = mode === 'probe-wait';
const reload =
  '    accountRows = await navigateList(page, expected, deps, guard, rowCounts);';
const mutation = enginePace
  ? {
      file: '/instagram/driver.ts',
      before: reload,
      after: '    await deps.sleep(deps.pace.intervalMs);\n' + reload,
    }
  : {
      file: '/fake-instagram/pages.ts',
      before: 'if(applied)return;',
      after: '',
    };
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c6-fresh-view-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith(mutation.file)) return null;
        if (source.split(mutation.before).length !== 2)
          throw new Error('Stale C6 red control.');
        return {
          code: source.replace(mutation.before, mutation.after),
          map: null,
        };
      },
    },
  ],
  test: {
    environment: 'node',
    include: [
      enginePace
        ? 'apps/cli/e2e/engine-run-controls.test.ts'
        : 'apps/cli/e2e/context-instagram.test.ts',
    ],
    testNamePattern: enginePace
      ? 'Instagram engine pauses only after a complete step and rejects automatic canary acceptance'
      : 'C6 fake refuses',
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: enginePace ? 90000 : 60000,
    hookTimeout: 30000,
  },
});
