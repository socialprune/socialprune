import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('browser-init subpath enables global zod jitless in a fresh process', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "import { z } from 'zod';",
        'z.config({ jitless: false });',
        'const before = z.config().jitless;',
        "const init = await import('@socialprune/core/browser-init');",
        "const guide = await import('@socialprune/core/guide/types');",
        'console.log(JSON.stringify({ before, after: z.config().jitless, initExports: Object.keys(init), guideExports: Object.keys(guide) }));',
      ].join('\n'),
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  const configuration: unknown = JSON.parse(result.stdout);
  expect(configuration).toEqual({
    before: false,
    after: true,
    initExports: [],
    guideExports: [],
  });
});

test('browser-init and guide types resolve through the package exports', () => {
  expect(import.meta.resolve('@socialprune/core/browser-init')).toBe(
    new URL('./browser-init.ts', import.meta.url).href,
  );
  expect(import.meta.resolve('@socialprune/core/guide/types')).toBe(
    new URL('./guide/types.ts', import.meta.url).href,
  );
});
