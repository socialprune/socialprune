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
