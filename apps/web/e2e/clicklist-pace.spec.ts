import { test, expect } from '@playwright/test';
import { clickListFixture, restoreClickLists } from './clicklist-fixture.ts';

test('twenty actual outcomes switch to measured pace, corrections do not count and the estimate can be hidden', async ({
  page,
}) => {
  const fixture = clickListFixture();
  const item = fixture.items[0]!;
  fixture.items = Array.from({ length: 24 }, (_, index) => ({
    ...item,
    id: `x:pace-${index}`,
    text: `Invented pace entry ${index}.`,
    url: null,
  }));
  fixture.assessments = [];
  fixture.decisionEvents = fixture.items.map((item, index) => ({
    ...fixture.decisionEvents[0]!,
    eventId: `pace-mark-${index}`,
    seq: index + 1,
    itemId: item.id,
    action: {
      id: `pace-action-${index}`,
      kind: 'single',
      size: 1,
      reverts: null,
    },
  }));
  fixture.counts = {
    ...fixture.counts,
    items: 24,
    assessments: 0,
    decisionEvents: 24,
  };
  await restoreClickLists(page, fixture);
  await page.goto('/socialprune/#/clicklist/x');
  await expect(
    page.getByRole('button', { name: 'Start', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('spinbutton', { name: 'Seconds per entry', exact: true })
    .fill('9');
  await expect(
    page.getByText('If it takes you 9 seconds per entry', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const list = page.getByRole('list', {
    name: 'Marked entries to find on the platform',
  });
  for (let index = 0; index < 19; index++) {
    await list
      .locator(`[data-item-id="x:pace-${index}"]`)
      .getByRole('button', { name: 'I did it', exact: true })
      .click();
    await expect(
      page.getByText(
        `${index + 1} deleted by you, 0 skipped, ${23 - index} left.`,
        { exact: true },
      ),
    ).toBeVisible();
  }
  await expect(
    page.getByText('If you continue at your measured pace', { exact: false }),
  ).toHaveCount(0);
  await list
    .locator('[data-item-id="x:pace-0"]')
    .getByRole('button', { name: 'Correct this record', exact: true })
    .click();
  await expect(
    page.getByText('18 deleted by you, 0 skipped, 6 left.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('If you continue at your measured pace', { exact: false }),
  ).toHaveCount(0);
  await list
    .locator('[data-item-id="x:pace-19"]')
    .getByRole('button', { name: 'Skip', exact: true })
    .click();
  await expect(
    page.getByText('If you continue at your measured pace', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Hide time estimate', exact: true })
    .click();
  await expect(
    page.getByRole('spinbutton', { name: 'Seconds per entry', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Show time estimate', exact: true })
    .click();
  await expect(
    page.getByText('If you continue at your measured pace', { exact: false }),
  ).toBeVisible();
});

test('D S and Enter stay inert outside list focus or with single-key shortcuts off', async ({
  page,
}) => {
  await restoreClickLists(page);
  await page.goto('/socialprune/#/clicklist/x');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const entry = page.locator('[data-item-id="x:102"]');
  // Start moves focus on the next animation frame. Let that handoff finish
  // before moving outside the list, so the keys test the intended focus scope.
  await expect(entry).toBeFocused();
  await page.evaluate(() => {
    Reflect.set(globalThis, '__platformOpens', []);
    document.addEventListener('click', (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[data-open-platform]',
      );
      if (!link) return;
      event.preventDefault();
      (Reflect.get(globalThis, '__platformOpens') as string[]).push(link.href);
    });
  });
  const seconds = page.getByRole('spinbutton', {
    name: 'Seconds per entry',
    exact: true,
  });
  await seconds.focus();
  await expect(seconds).toBeFocused();
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await expect(seconds).toBeFocused();
  await expect(
    page.getByText('0 deleted by you, 0 skipped, 4 left.', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.setItem('sp-single-keys', 'off'));
  await entry.focus();
  await expect(entry).toBeFocused();
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('0 deleted by you, 0 skipped, 4 left.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, '__platformOpens') as string[],
    ),
  ).toEqual([]);
  await page.evaluate(() => localStorage.setItem('sp-single-keys', 'on'));
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, '__platformOpens') as string[],
    ),
  ).toEqual(['https://x.com/invented_x/status/102']);
});
