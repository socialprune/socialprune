import { expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import { listFreshness } from './list-freshness.ts';

test('C-list signature retains only equality booleans across steps, not text, labels, media or digests', async () => {
  let content = 'Generated before';
  let broken = false;
  const page = {
    locator: () => ({
      allInnerTexts: () => {
        if (broken) throw new Error('Generated read failure');
        return Promise.resolve([content]);
      },
      nth: () => ({
        getAttribute: () => Promise.resolve('Generated label'),
        locator: () => ({ all: () => Promise.resolve([]) }),
      }),
    }),
  } as unknown as Page;
  const tracker = listFreshness();
  const window = ['2025-01-01', '2025-01-03'] as const;
  await tracker.beforeApply(page, window);
  expect(await tracker.inspect(page)).toEqual({
    observed: true,
    sameAsBeforeApply: true,
    sameAsPreviousStep: null,
    previousWindowDifferent: null,
  });
  content = 'Generated after';
  const first = await tracker.inspect(page);
  expect(first).toEqual({
    observed: true,
    sameAsBeforeApply: false,
    sameAsPreviousStep: null,
    previousWindowDifferent: null,
  });
  tracker.finish();
  expect(await tracker.inspect(page)).toMatchObject({
    observed: false,
    sameAsBeforeApply: null,
    sameAsPreviousStep: null,
    previousWindowDifferent: null,
  });
  content = 'Generated before';
  await tracker.beforeApply(page, ['2025-05-01', '2025-05-03']);
  content = 'Generated after';
  expect(await tracker.inspect(page)).toEqual({
    observed: true,
    sameAsBeforeApply: false,
    sameAsPreviousStep: true,
    previousWindowDifferent: true,
  });
  tracker.finish();
  await tracker.beforeApply(page, ['2025-05-01', '2025-05-03']);
  expect(await tracker.inspect(page)).toEqual({
    observed: true,
    sameAsBeforeApply: true,
    sameAsPreviousStep: true,
    previousWindowDifferent: false,
  });
  broken = true;
  expect(await tracker.inspect(page)).toMatchObject({
    observed: false,
    sameAsBeforeApply: null,
    sameAsPreviousStep: null,
  });
  tracker.finish();
  broken = false;
  await tracker.beforeApply(page, window);
  expect(await tracker.inspect(page)).toMatchObject({
    sameAsPreviousStep: null,
    previousWindowDifferent: null,
  });
  expect(JSON.stringify(first)).not.toMatch(/Generated|2025|[a-f0-9]{64}/);
});
test('RETAIN-1 rewind lets a fresh read compare with the same base as the first read', async () => {
  let content = 'Generated A rows';
  const page = {
    locator: () => ({
      allInnerTexts: () => Promise.resolve([content]),
      nth: () => ({
        getAttribute: () => Promise.resolve('Generated label'),
        locator: () => ({ all: () => Promise.resolve([]) }),
      }),
    }),
  } as unknown as Page;
  const tracker = listFreshness();
  const read = async (window: readonly [string, string], rows: string) => {
    content = 'Generated unfiltered';
    await tracker.beforeApply(page, window);
    content = rows;
    const signature = await tracker.inspect(page);
    tracker.finish();
    return signature;
  };
  await read(['2025-01-01', '2025-01-03'], 'Generated A rows');
  const first = await read(['2025-01-02', '2025-01-04'], 'Generated A rows');
  expect(first).toMatchObject({
    sameAsPreviousStep: true,
    previousWindowDifferent: true,
  });
  // Without rewind the same window compares with the first read itself.
  tracker.rewind();
  expect(await read(['2025-01-02', '2025-01-04'], 'Generated A rows')).toEqual(
    first,
  );
  // After the fresh read the chain continues from that fresh read.
  expect(
    await read(['2025-01-02', '2025-01-04'], 'Generated A rows'),
  ).toMatchObject({ sameAsPreviousStep: true, previousWindowDifferent: false });
});
