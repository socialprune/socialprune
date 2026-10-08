import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { guides } from '../app/guide.ts';
import { checkGuides } from '@socialprune/core/guide/check';
import { shellManifest } from '../../tooling/manifest.ts';

test('a release build runs the production manifest gate and rejects unverified guide data', async () => {
  expect(guides.length).toBeGreaterThan(0);
  expect(
    checkGuides(guides, {
      today: '2026-10-08',
      maxAgeDays: 120,
      release: true,
    }).every(({ code }) => code === 'unverified'),
  ).toBe(true);
  await expect(
    build({
      root: fileURLToPath(new URL('../../', import.meta.url)),
      // Exercise the real release hook without loading unrelated demo ZIP
      // generation from vite.config.ts. The separate build:release gate proves
      // that the normal config wires this same plugin into production.
      configFile: false,
      plugins: [shellManifest('release')],
      mode: 'release',
      logLevel: 'silent',
      build: { write: false },
    }),
  ).rejects.toThrow(/Guide release check failed.*unverified/s);
});

test.each([
  [[], 0],
  [['--', '--max-age', '120'], 0],
  [['--max-age', '120', '--release'], 1],
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
  if (status === 1)
    expect(result.stderr.toString('utf8')).toContain('unverified');
});
