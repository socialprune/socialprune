import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { observeImport, waitForApp } from './helpers.ts';
import { personExpected, personFixture } from '../test/person-fixture.ts';
import { checkAccessibility } from './accessibility.ts';

export async function restorePerson(page: Page) {
  await waitForApp(page);
  const reply = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-person-views.json'),
      }),
    JSON.stringify(personFixture()),
  );
  expect(reply.type).toBe('opened');
  await page.goto('/socialprune/#/review');
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption(personExpected.accountKey);
  await expect(
    page.getByTestId('review-card').locator('article'),
  ).toHaveAttribute('data-item-id', personExpected.suggestionIds[0]);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    let text = '';
    await window.workspace.backup(async (file) => {
      text = await file.text();
    });
    return JSON.parse(text) as import('@socialprune/core').WorkspaceV2;
  });
}
async function markSuggestions(page: Page) {
  await page
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Synthetic reviewer');
  const confirm = dialog.getByRole('button', {
    name: 'Mark for deletion: 2 entries',
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
}

test('card J K L U preserve human decisions, advance, ignore repeats and update progress under network audit', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restorePerson(page);
  const region = page.getByTestId('review-card'),
    progress = page.getByRole('progressbar', { name: 'Review', exact: true });
  await expect(progress).toHaveAttribute('value', '0');
  await expect(progress).toHaveAttribute('max', '7');
  await region.focus();
  await page.keyboard.press('j');
  await expect(progress).toHaveAttribute('value', '1');
  await expect(region.locator('article')).toHaveAttribute(
    'data-item-id',
    personExpected.suggestionIds[1],
  );
  await region.focus();
  await page.keyboard.press('k');
  await expect(progress).toHaveAttribute('value', '2');
  await region.focus();
  await page.keyboard.press('l');
  await expect(progress).toHaveAttribute('value', '3');
  const before = await snapshot(page);
  expect(before.decisionEvents.map(({ value }) => value)).toEqual([
    'delete',
    'keep',
    'later',
  ]);
  expect(
    before.decisionEvents.every(
      ({ source }) => source.kind === 'human' && source.via === 'web-review',
    ),
  ).toBe(true);
  await region.focus();
  await page.keyboard.press('u');
  await expect(progress).toHaveAttribute('value', '2');
  const undone = await snapshot(page);
  expect(undone.decisionEvents.at(-1)).toMatchObject({
    value: 'undecided',
    source: { kind: 'human', via: 'web-review' },
    action: { kind: 'undo' },
  });
  await region.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', repeat: true, bubbles: true }),
    ),
  );
  await page.evaluate(() => localStorage.setItem('sp-single-keys', 'off'));
  await region.focus();
  await page.keyboard.press('j');
  expect((await snapshot(page)).decisionEvents).toEqual(undone.decisionEvents);
  await page.evaluate(() => localStorage.setItem('sp-single-keys', 'on'));
  await page.getByRole('combobox', { name: 'What to review' }).focus();
  await page.keyboard.press('k');
  expect((await snapshot(page)).decisionEvents).toEqual(undone.decisionEvents);
  await checkAccessibility(page, context);
  await audit.assert();
});

test('card bulk preview cancels without mutation and human confirm marks exact fixture suggestions', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restorePerson(page);
  await page
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 2 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await snapshot(page)).decisionEvents).toEqual([]);
  await markSuggestions(page);
  const saved = await snapshot(page);
  expect(saved.decisionEvents.map(({ itemId }) => itemId).sort()).toEqual(
    [...personExpected.suggestionIds].sort(),
  );
  expect(
    saved.decisionEvents.every(
      ({ value, source, action }) =>
        value === 'delete' &&
        source.kind === 'human' &&
        source.via === 'web-review' &&
        action.kind === 'bulk',
    ),
  ).toBe(true);
  await expect(
    page.getByRole('progressbar', { name: 'Review', exact: true }),
  ).toHaveAttribute('value', '2');
  await audit.assert();
});

test('delete mode opens only a synthetic tab, records Done and Skip with human sources and reaches settlement', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restorePerson(page);
  await markSuggestions(page);
  await page.goto('/socialprune/#/clicklist/x/go');
  const card = page.getByTestId('delete-card');
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    personExpected.deleteIds[0],
  );
  const link = card.locator('[data-open-platform]');
  await expect(link).toHaveAttribute(
    'href',
    'https://x.com/invented_review/status/1',
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // LL-002: a generated, same-origin destination proves the real new-tab click
  // while the independent fixture URL assertion proves production link wiring.
  await link.evaluate((element) => {
    (element as HTMLAnchorElement).href =
      location.origin + '/socialprune/#/privacy';
  });
  await card.focus();
  const popupPromise = context.waitForEvent('page');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await expect(
    popup.getByRole('heading', { name: 'Privacy', exact: true }),
  ).toBeVisible();
  await card.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        repeat: true,
        bubbles: true,
      }),
    ),
  );
  expect(context.pages()).toHaveLength(2);
  await popup.close();
  await card.focus();
  await page.keyboard.press('Space');
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    personExpected.deleteIds[1],
  );
  await expect(
    page.getByRole('progressbar', { name: 'Deletion mode', exact: true }),
  ).toHaveAttribute('value', '1');
  await page.getByRole('button', { name: 'Skip S', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'The list is through.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Deletion mode', exact: true }),
  ).toHaveAttribute('value', '2');
  const saved = await snapshot(page);
  expect(
    saved.outcomeEvents.map(({ itemId, value, source }) => ({
      itemId,
      value,
      source,
    })),
  ).toEqual([
    {
      itemId: personExpected.deleteIds[0],
      value: 'deleted-by-user',
      source: { kind: 'human', via: 'web-review' },
    },
    {
      itemId: personExpected.deleteIds[1],
      value: 'skipped',
      source: { kind: 'human', via: 'web-review' },
    },
  ]);
  await page
    .getByRole('button', { name: 'Correct this record', exact: true })
    .click();
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    personExpected.deleteIds[1],
  );
  expect((await snapshot(page)).outcomeEvents.at(-1)).toMatchObject({
    value: 'unknown',
    source: { kind: 'human', via: 'web-review' },
  });
  await audit.assert();
});

test('archive joins only own thread, keeps deleted item, year jumps/search include complete thread and recap matches fixture', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restorePerson(page);
  await markSuggestions(page);
  await page.goto('/socialprune/#/clicklist/x/go');
  await expect(
    page.getByTestId('delete-card').locator('article'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Done Space', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1');
  await page.goto('/socialprune/#/archive');
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption(personExpected.accountKey);
  await expect(page.getByTestId('recap')).toBeVisible();
  const thread = page.locator('[data-thread-size="3"]');
  expect(
    await thread
      .locator('article')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-item-id')),
      ),
  ).toEqual(personExpected.thread);
  await expect(
    page.locator(`article[data-item-id="${personExpected.deleteIds[0]}"]`),
  ).toContainText('deleted on X');
  await expect(
    page.locator(`article[data-item-id="${personExpected.foreignReplyId}"]`),
  ).toContainText('Replying to @generated_other');
  await expect(page.getByTestId('archive-banner')).toHaveAttribute(
    'data-palette',
    /^[0-3]$/,
  );
  await expect(page.getByTestId('recap')).toContainText('2020');
  await expect(page.getByTestId('recap')).toContainText('3 entries');
  const stats = page.getByTestId('recap').locator('strong');
  await expect(stats.nth(2)).toHaveText(
    String(personExpected.recapAt20261010.likes),
  );
  await expect(stats.nth(3)).toHaveText(
    String(personExpected.recapAt20261010.lols),
  );
  await page.getByRole('button', { name: '2020', exact: true }).click();
  expect(
    await page
      .locator('article')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-item-id')),
      ),
  ).toEqual(personExpected.year2020Ids);
  await page
    .getByRole('combobox', { name: 'Year', exact: true })
    .selectOption('all');
  await page
    .getByRole('searchbox', { name: 'Search the archive', exact: true })
    .fill(personExpected.query);
  await expect(page.locator('article')).toHaveCount(3);
  expect(
    await page
      .locator('article')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-item-id')),
      ),
  ).toEqual(personExpected.thread);
  await page.getByRole('searchbox').fill('');
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption('synthetic-comment');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText(
    'Comment on @generated_owner',
  );
  await checkAccessibility(page, context);
  await audit.assert();
});

test('three primary destinations and one keyboard-operable menu reflow at 320px with danger contrast in both themes', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restorePerson(page);
  const nav = page.getByRole('navigation', {
    name: 'Primary navigation',
    exact: true,
  });
  expect(await nav.getByRole('link').allTextContents()).toEqual([
    'Review',
    'Delete',
    'Archive',
  ]);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByTestId('app-menu');
  await expect(menu).toBeVisible();
  expect(await menu.getByRole('link').allTextContents()).toEqual([
    'Start',
    'Open export',
    'Try the demo',
    'Get your export',
    'Backup and restore',
    'Settings',
    'Privacy',
    'List view',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Menu', exact: true }),
  ).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const colors = await page
      .getByRole('button', { name: 'Delete J', exact: true })
      .evaluate((button) => {
        const css = getComputedStyle(button);
        return [css.color, css.backgroundColor, css.borderColor];
      });
    const luminance = (rgb: string) =>
      rgb
        .match(/\d+/g)!
        .slice(0, 3)
        .map(Number)
        .map((c) => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!,
          0,
        );
    const ratio = (a: string, b: string) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) /
      (Math.min(luminance(a), luminance(b)) + 0.05);
    expect(ratio(colors[0]!, colors[1]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colors[2]!, colors[1]!)).toBeGreaterThanOrEqual(3);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await audit.assert();
});
