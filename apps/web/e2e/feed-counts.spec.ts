import { expect, test } from '@playwright/test';
import { scaleWorkspace, SCALE_ACCOUNT } from './scale-data.ts';
import { waitForApp } from './helpers.ts';

test('a level change recomputes100000entry counts through the real browser worker', async ({
  page,
}) => {
  // The accepted scale baseline measured191.8s for this restore alone.
  // Count timings below still enforce500ms independently of setup.
  test.setTimeout(360_000);
  await waitForApp(page);
  const data = await scaleWorkspace(100_000);
  const samples = await page.evaluate(
    async ({ text, accountKey }) => {
      const restored = await window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-count-cache.json'),
      });
      if (restored.type !== 'opened') throw Error('Generated restore failed');
      const initial = await window.workspace.planCounts(accountKey);
      const result = [];
      for (const level of [0, 1, 2] as const) {
        await window.workspace.setCriteria({
          ...restored.summary.criteria!,
          level,
        });
        const begin = performance.now();
        const counts = await window.workspace.planCounts(accountKey);
        result.push({
          level,
          ms: performance.now() - begin,
          type: counts.type,
          tabs: counts.type === 'planCounts' ? counts.tabs : null,
        });
      }
      return {
        initial: initial.type === 'planCounts' ? initial.tabs : null,
        result,
      };
    },
    { text: data.text, accountKey: SCALE_ACCOUNT },
  );
  console.log('M3_COLD_WORKER_SAMPLES', JSON.stringify(samples));
  expect(samples.initial?.suggested).toBe(6000);
  for (const sample of samples.result) {
    expect(sample.tabs).toEqual({
      suggested: 6000,
      held: 0,
      kept: 0,
      unclear: 0,
      marked: 0,
      all: 100000,
    });
    expect(sample.ms).toBeLessThan(500);
  }
});
