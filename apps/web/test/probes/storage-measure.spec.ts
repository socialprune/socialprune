import { test, expect } from '@playwright/test';
import { measurementIdentity } from '../../tooling/measurement-identity.ts';

test('100k production storage path versus raw IndexedDB in the same browser', async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  const sourceHash = await measurementIdentity();
  await page.goto('/socialprune/icon.svg');
  const result = await page.evaluate(async () => {
    const module = (await import(
      /* @vite-ignore */ `${location.origin}/socialprune/storage-measure.js`
    )) as {
      measureStorage(): Promise<{
        count: number;
        productionMs: number;
        rawMs: number;
        slowerPercent: number;
      }>;
    };
    return module.measureStorage();
  });
  expect(result.count).toBe(100_000);
  console.log(
    JSON.stringify({
      engine: browserName,
      sourceHash,
      storageMeasurement: result,
    }),
  );
  expect(await measurementIdentity()).toBe(sourceHash);
});
