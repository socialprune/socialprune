import { test, expect } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';

test('switching list modes waits for a pending decision and preserves filter, sort and backup result', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker;
    globalThis.Worker = class extends Original {
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const value = message as { type?: string };
        const transfer = Array.isArray(options)
          ? options
          : (options?.transfer ?? []);
        if (value.type === 'decide')
          Reflect.set(globalThis, '__releaseHeldDecision', () =>
            super.postMessage(message, transfer),
          );
        else super.postMessage(message, transfer);
      }
    };
  });
  const fixture = await restoreReview(
    page,
    reviewFixture('personal', false, 150),
  );
  await page.getByRole('searchbox').fill('review');
  await expect(
    page.getByText('148 entries in this view', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Sort by', exact: true })
    .selectOption('likes');
  await expect(page.getByRole('row').first()).toContainText(
    'Invented review entry 149',
  );
  await page.getByRole('grid').focus();
  await page.keyboard.press('k');
  await expect(page.getByTestId('save-state')).toHaveText('Saving...');
  await page.getByRole('button', { name: 'Paged list', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.evaluate(() =>
    (Reflect.get(globalThis, '__releaseHeldDecision') as () => void)(),
  );
  await expect(
    page.getByRole('button', { name: 'Review grid', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText(
    'Saved on this device',
  );
  await expect(page.getByRole('searchbox')).toHaveValue('review');
  await expect(
    page.getByRole('combobox', { name: 'Sort by', exact: true }),
  ).toHaveValue('likes');
  await expect(
    page.getByRole('button', { name: 'Open details', exact: true }),
  ).toHaveCount(100);
  let backupText = await page.evaluate(async () => {
    let text = '';
    await window.workspace.backup(async (file) => {
      text = await file.text();
    });
    return text;
  });
  const before = JSON.parse(backupText) as {
    counts: { items: number };
    decisionEvents: { value: string }[];
  };
  expect(before.counts.items).toBe(fixture.items.length);
  expect(before.decisionEvents).toMatchObject([{ value: 'keep' }]);
  await page.getByRole('button', { name: 'Review grid', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  backupText = await page.evaluate(async () => {
    let text = '';
    await window.workspace.backup(async (file) => {
      text = await file.text();
    });
    return text;
  });
  const after = JSON.parse(backupText) as {
    counts: unknown;
    decisionEvents: unknown;
  };
  expect(after.counts).toEqual(before.counts);
  expect(after.decisionEvents).toEqual(before.decisionEvents);
});
