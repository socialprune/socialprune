import { expect, test } from '@playwright/test';
import { restoreLiveFeed, liveExpected } from './feed-fixture.ts';
import { observeImport } from './helpers.ts';

test('successive list decisions retain dimmed cards and focus the next card', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreLiveFeed(page);
  const feed = page.getByRole('feed');
  for (const [name, ids] of [
    ['Suggested for deletion', liveExpected.suggested],
    ['Held back by your rules', liveExpected.held],
    ['Kept', liveExpected.kept],
    ['Unclear', liveExpected.unclear],
    ['Marked', liveExpected.marked],
  ] as const) {
    await page.getByRole('tab', { name: new RegExp(`^${name},`) }).click();
    await expect(feed).toHaveAttribute('aria-busy', 'false');
    await expect
      .poll(() =>
        feed
          .locator('article')
          .evaluateAll((rows) =>
            rows.map((row) => row.getAttribute('data-item-id')),
          ),
      )
      .toEqual([...ids]);
  }
  await page.getByRole('tab', { name: /^Held back by your rules,/ }).click();
  await expect(feed).toContainText('14 likes');
  await expect(feed.getByRole('button', { name: /Mark anyway/ })).toBeVisible();
  await page.getByRole('tab', { name: /^All,/ }).click();
  const held = feed.locator('article[data-card-id="x:feed-4"]');
  await expect(held.getByRole('button', { name: /Mark anyway/ })).toBeVisible();
  await held.getByRole('button', { name: /Mark anyway/ }).click();
  await expect(held).toHaveAttribute('data-decision', 'delete');
  await held.focus();
  await page.keyboard.press('u');
  await expect(held).toHaveAttribute('data-decision', 'undecided');
  await page.getByRole('tab', { name: /^Suggested for deletion,/ }).click();
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await feed.locator('article').first().focus();
  await page.keyboard.press('j');
  await expect(feed.locator('article').first()).toHaveAttribute(
    'data-decision',
    'undecided',
  );
  await page.keyboard.press('k');
  await expect(
    feed.locator('article[data-card-id="x:feed-1"]'),
  ).toHaveAttribute('data-decision', 'keep');
  await expect(
    feed.locator('article[data-card-id="x:feed-1"]'),
  ).toHaveAttribute('data-decided', 'true');
  await expect(feed.locator('article[data-card-id="x:feed-2"]')).toBeFocused();
  await page.keyboard.press('k');
  await expect(feed.locator('article[data-card-id="x:feed-3"]')).toBeFocused();
  await audit.assert();
});
