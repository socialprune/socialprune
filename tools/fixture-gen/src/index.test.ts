import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { variants as instagramVariants } from './instagram/index.ts';
import { checkFixtures, createRandom, writeVariants } from './index.ts';
import type { Variant } from './shared/index.ts';
import { variants as xVariants } from './x/index.ts';

test('starts with no platform variants', () => {
  expect([...xVariants, ...instagramVariants]).toEqual([]);
});

test('seeded random sequences repeat and stay in range', () => {
  const first = createRandom(42);
  const second = createRandom(42);
  const values = Array.from({ length: 50 }, () => first());
  expect(values).toEqual(Array.from({ length: 50 }, () => second()));
  expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  expect(values).not.toEqual(Array.from({ length: 50 }, createRandom(43)));
});

test('fixture checks compare paths and bytes, including unexpected files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-fixture-test-'));
  const variant: Variant = {
    id: 'test-variant',
    platform: 'x',
    description: 'Generated fixture for the tree comparison test.',
    files: { 'data/notes.txt': 'generated content\n' },
    expected: { count: 1 },
  };
  try {
    expect(await checkFixtures(root, [])).toEqual([]);
    await writeVariants(root, [variant]);
    expect(await checkFixtures(root, [variant])).toEqual([]);
    await writeFile(join(root, 'x/test-variant/data/notes.txt'), 'changed\n');
    await writeFile(join(root, 'extra.txt'), 'unexpected\n');
    expect(await checkFixtures(root, [variant])).toEqual([
      'extra.txt',
      'x/test-variant/data/notes.txt',
    ]);
    await expect(
      writeVariants(root, [{ ...variant, files: { '../outside.txt': 'no' } }]),
    ).rejects.toThrow('relative');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
