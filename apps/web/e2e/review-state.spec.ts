import { test, expect } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';
import { observeImport } from './helpers.ts';

test('account, filter and sort changes clear selection and detail without changing a decision', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const fixture = reviewFixture('personal', false);
  const otherItems = fixture.items.slice(0, 3).map((item, index) => ({
    ...item,
    id: `x:other-review-${index}`,
    text: `Other invented account entry ${index}.`,
    account: { key: 'synthetic-other', handle: 'invented_other' },
  }));
  fixture.items.push(...otherItems);
  fixture.counts.items = fixture.items.length;
  await restoreReview(page, fixture);
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Entry details' }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption('synthetic-other');
  await expect(page.getByRole('region', { name: 'Entry details' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('row').first()).toContainText(
    'Other invented account',
  );
  await expect(
    page.getByText('0 entries selected', { exact: false }),
  ).toBeVisible();
  await grid.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page
    .getByRole('combobox', { name: 'Decision filter', exact: true })
    .selectOption('keep');
  await expect(page.getByRole('region', { name: 'Entry details' })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(
      'No entries match these filters. Clear them to see the rest.',
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page.getByRole('row')).toHaveCount(3);
  await page
    .getByRole('combobox', { name: 'Sort by', exact: true })
    .selectOption('likes');
  await page.getByRole('searchbox').focus();
  await page.keyboard.type('mkl');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.getByRole('searchbox')).toHaveValue('mkl');
  expect(
    await page.evaluate(() =>
      window.workspace.request({
        type: 'history',
        requestId: crypto.randomUUID(),
        limit: 50,
      }),
    ),
  ).toMatchObject({ type: 'historyEntries', entries: [] });
  await audit.assert();
});

test('mobile detail is the full view and returns to the same virtual scroll position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await restoreReview(page, reviewFixture('personal', false, 40));
  const grid = page.getByRole('grid');
  await grid.focus();
  for (let index = 0; index < 10; index++)
    await page.keyboard.press('ArrowDown');
  const active = await grid.getAttribute('aria-activedescendant');
  const before = await grid.evaluate((element) => element.scrollTop);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Entry details' }),
  ).toBeVisible();
  await expect(grid).toBeHidden();
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(grid).toBeVisible();
  await expect(grid).toBeFocused();
  await expect(grid).toHaveAttribute('aria-activedescendant', active!);
  expect(await grid.evaluate((element) => element.scrollTop)).toBeCloseTo(
    before,
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('saving only becomes saved after commit and a storage failure keeps the prior decision with backup access', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker;
    globalThis.Worker = class extends Original {
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const value = message as { type?: string; requestId?: string };
        const transfer = Array.isArray(options)
          ? options
          : (options?.transfer ?? []);
        if (
          value.type === 'decide' &&
          Reflect.get(globalThis, '__rejectNextDecision') === true
        ) {
          Reflect.set(globalThis, '__rejectNextDecision', false);
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'failed',
                    requestId: value.requestId,
                    code: 'STORAGE',
                  },
                }),
              ),
            200,
          );
        } else if (value.type === 'decide')
          setTimeout(() => super.postMessage(message, transfer), 250);
        else super.postMessage(message, transfer);
      }
    };
  });
  const fixture = await restoreReview(page, reviewFixture('personal', false));
  await page.getByRole('grid').focus();
  await page.keyboard.press('k');
  await expect(page.getByTestId('save-state')).toHaveText('Saving...');
  await expect(page.getByTestId('save-state')).toHaveText(
    'Saved on this device',
  );
  await page.evaluate(() =>
    Reflect.set(globalThis, '__rejectNextDecision', true),
  );
  await page.getByRole('grid').focus();
  await page.keyboard.press('m');
  await expect(page.getByTestId('save-state')).toHaveText(
    'Not saved. Your last change could not be stored.',
  );
  await expect(page.getByRole('alert')).toContainText(
    'The browser could not save your review. Download a backup before trying again.',
  );
  await expect(
    page
      .getByRole('alert')
      .getByRole('button', { name: 'Download backup', exact: true }),
  ).toBeEnabled();
  const detail = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    fixture.items[0]!.id,
  );
  expect(detail).toMatchObject({
    type: 'itemDetail',
    events: [{ value: 'keep' }],
  });
});

test('templates and explicit unknown engagement filters never apply a decision', async ({
  page,
}) => {
  await restoreReview(page);
  await page.getByText('More filters and templates', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Filter template', exact: true })
    .selectOption('replies');
  await expect(page.getByRole('row')).toHaveCount(1);
  await expect(page.getByRole('row')).toContainText('Reply');
  await page
    .getByRole('combobox', { name: 'Filter template', exact: true })
    .selectOption('none');
  await page
    .getByRole('combobox', { name: 'Unknown likes', exact: true })
    .selectOption('only');
  await expect(page.getByRole('row')).toHaveCount(1);
  await expect(page.getByRole('row')).toContainText('café note');
  expect(
    await page.evaluate(() =>
      window.workspace.request({
        type: 'history',
        requestId: crypto.randomUUID(),
        limit: 50,
      }),
    ),
  ).toMatchObject({ type: 'historyEntries', entries: [] });
});

test('pointer scroll recycles the bounded window and deliberately restores a mounted active row', async ({
  page,
}) => {
  await restoreReview(page, reviewFixture('personal', false, 600));
  const grid = page.getByRole('grid');
  await grid.focus();
  await grid.evaluate((element) => {
    element.scrollTop = 50000;
  });
  await expect
    .poll(async () =>
      Number(await page.getByRole('row').first().getAttribute('aria-rowindex')),
    )
    .toBeGreaterThan(200);
  await expect
    .poll(() =>
      grid.evaluate((element) => {
        const id = element.getAttribute('aria-activedescendant');
        return id ? document.getElementById(id)?.isConnected : false;
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.workspace.rows.length),
  ).toBeLessThanOrEqual(200);
});

test('detail displays only latest assessments per source, strongest first, and no confidence number', async ({
  page,
}) => {
  const workspace = reviewFixture();
  workspace.assessments[0]!.confidence = 0.91;
  workspace.assessments.push({
    ...workspace.assessments[0]!,
    assessmentId: 'current-assessment',
    createdAt: '2026-10-03T12:00:00.000Z',
    risk: 3,
    reason: 'Current invented suggestion.',
    evidence: 'words',
    confidence: 0.99,
  });
  workspace.counts.assessments++;
  workspace.submissions[0]!.labelCount++;
  await restoreReview(page, workspace);
  await page.getByRole('grid').focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: 'Entry details' });
  await expect(detail).toContainText('Current invented suggestion.');
  await expect(detail).not.toContainText(
    'This invented excerpt is included to test the review.',
  );
  await expect(detail.locator('mark')).toHaveText('words');
  await expect(detail).not.toContainText('99%');
});
