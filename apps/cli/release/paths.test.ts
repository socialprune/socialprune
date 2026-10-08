import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { reviewAssetDirectory } from '../src/review/static.ts';
import { reviewDatabaseWorkerUrl } from '../src/review/database.ts';

test('source assets and worker still resolve to their workspace locations', () => {
  expect(reviewAssetDirectory()).toBe(
    fileURLToPath(new URL('../../web/dist-review/', import.meta.url)),
  );
  expect(reviewDatabaseWorkerUrl()).toEqual(
    new URL('../src/review/database-worker.ts', import.meta.url),
  );
});

test('packed assets resolve beside bin, including a path containing spaces', () => {
  const root = resolve('temporary install', 'node_modules/socialprune');
  expect(
    reviewAssetDirectory(
      pathToFileURL(resolve(root, 'bin/socialprune.mjs')).href,
    ),
  ).toBe(fileURLToPath(pathToFileURL(resolve(root, 'web') + '/')));
});
