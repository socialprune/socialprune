import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { guides } from '../app/guide.ts';
import { checkGuides } from '@socialprune/core/guide/check';
import { shellManifest } from '../../tooling/manifest.ts';

test('a release build accepts the maintainer-confirmed guide data', async () => {
  expect(guides.length).toBeGreaterThan(0);
  expect(
    checkGuides(guides, {
      today: '2026-10-25',
      maxAgeDays: 120,
      release: true,
    }),
  ).toEqual([]);
  await expect(
    build({
      root: fileURLToPath(new URL('../../', import.meta.url)),
      // Exercise the real release hook with a bounded existing source entry.
      // The separate build:release command proves the whole application.
      configFile: false,
      plugins: [shellManifest('release')],
      mode: 'release',
      logLevel: 'silent',
      build: {
        write: false,
        lib: {
          entry: fileURLToPath(new URL('./reminder.ts', import.meta.url)),
          formats: ['es'],
        },
      },
    }),
  ).resolves.toBeDefined();
});

test('the release hook still rejects one unconfirmed fact without mutating shipped data', () => {
  const fact = guides[0]!.startUrl;
  const before = structuredClone(fact);
  const plugin = shellManifest('release');
  const hook = plugin.buildStart;
  expect(typeof hook).toBe('function');
  if (typeof hook !== 'function') throw new Error('Release hook absent.');
  try {
    fact.verifiedOn = null;
    expect(() => hook.call({} as never, {} as never)).toThrow(
      /Guide release check failed.*unverified/s,
    );
  } finally {
    fact.verifiedOn = before.verifiedOn;
  }
  expect(fact).toEqual(before);
});

test.each([
  [[], 0],
  [['--', '--max-age', '120'], 0],
  [['--max-age', '120', '--release'], 0],
  [['--max-age', '-1'], 2],
  [['--max-age'], 2],
  [['--unknown'], 2],
] as const)('guide CLI arguments %j exit %i', (args, status) => {
  const script = fileURLToPath(
    new URL('../../scripts/guide-check.ts', import.meta.url),
  );
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr.toString('utf8')).toBe(status);
});
