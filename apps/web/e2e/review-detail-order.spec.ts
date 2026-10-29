import { test, expect } from '@playwright/test';
import { restoreReview } from './review-fixture.ts';
import { captureDetailOrder, traceDetailOrder } from './review-detail-order.ts';

for (const home of [false, true])
  test(`detail ${home ? 'Home then ' : ''}Enter during a real search row reply is retained and never decides`, async ({
    page,
    browserName,
  }, info) => {
    await traceDetailOrder(page, browserName === 'chromium');
    try {
      await restoreReview(page);
      const search = page.getByRole('searchbox');
      await search.fill('no-synthetic-match');
      await expect(
        page.getByText('0 entries in this view', { exact: true }),
      ).toBeVisible();
      await page.evaluate(() =>
        (Reflect.get(globalThis, '__detailOrder') as { arm(): void }).arm(),
      );
      await search.fill('');
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              Reflect.get(globalThis, '__detailOrder') as { isHeld(): boolean }
            ).isHeld(),
          ),
        )
        .toBe(true);
      // Holding rows longer than 150ms intentionally replaces the visible
      // count with the searching label. Assert the real query count instead.
      expect(
        await page.evaluate(() =>
          (
            Reflect.get(globalThis, '__detailOrder') as { count(): number }
          ).count(),
        ),
      ).toBe(8);
      const grid = page.getByRole('grid');
      await grid.focus();
      await expect(grid).toBeFocused();
      if (home) await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await page.evaluate(() =>
        (
          Reflect.get(globalThis, '__detailOrder') as { release(): void }
        ).release(),
      );
      await expect(
        page.getByRole('region', { name: 'Entry details', exact: true }),
      ).toBeVisible();
      await expect(page.locator('mark')).toHaveText('café note');
      const history = await page.evaluate(() =>
        window.workspace.request({
          type: 'history',
          requestId: crypto.randomUUID(),
          limit: 50,
        }),
      );
      expect(history).toMatchObject({ type: 'historyEntries', entries: [] });
    } finally {
      await captureDetailOrder(page, info);
    }
  });

for (const supersede of [
  'Escape',
  'focus',
  'view',
  'movement',
  'revision',
] as const)
  test(`pending detail never overrides a newer ${supersede} command`, async ({
    page,
    browserName,
  }, info) => {
    await traceDetailOrder(page, browserName === 'chromium');
    try {
      await restoreReview(page);
      const search = page.getByRole('searchbox');
      await search.fill('no-synthetic-match');
      await expect(
        page.getByText('0 entries in this view', { exact: true }),
      ).toBeVisible();
      await page.evaluate(() =>
        (Reflect.get(globalThis, '__detailOrder') as { arm(): void }).arm(),
      );
      await search.fill('');
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              Reflect.get(globalThis, '__detailOrder') as { isHeld(): boolean }
            ).isHeld(),
          ),
        )
        .toBe(true);
      await page.getByRole('grid').focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      if (supersede === 'Escape') await page.keyboard.press('Escape');
      else if (supersede === 'focus') await search.focus();
      else if (supersede === 'movement') await page.keyboard.press('ArrowDown');
      else if (supersede === 'revision')
        await page.evaluate(() =>
          window.workspace.worker.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'changed',
                revision: 999,
                itemIds: 'many',
                countsChanged: true,
              },
            }),
          ),
        );
      else await search.fill('entry 2');
      await page.evaluate(() =>
        (
          Reflect.get(globalThis, '__detailOrder') as { release(): void }
        ).release(),
      );
      await expect(page.getByRole('row').first()).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Entry details', exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          window.workspace.request({
            type: 'history',
            requestId: crypto.randomUUID(),
            limit: 50,
          }),
        ),
      ).toMatchObject({ type: 'historyEntries', entries: [] });
    } finally {
      await captureDetailOrder(page, info);
    }
  });
