import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { observeImport, waitForApp } from './helpers.ts';
import {
  feedFixture,
  feedExpected,
  largeFeedFixture,
} from '../test/feed-fixture.ts';
import { checkAccessibility } from './accessibility.ts';

async function restoreFeed(page: Page, data = feedFixture(), total = 6) {
  await waitForApp(page);
  const result = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-feed.json'),
      }),
    JSON.stringify(data),
  );
  expect(result.type).toBe('opened');
  await page.goto('/socialprune/#/review');
  await expect(
    page.getByTestId('review-card').locator('article'),
  ).toBeVisible();
  await page
    .getByTestId('card-review')
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await expect(page.getByTestId('feed-count')).toHaveText(
    `0 of ${total} decided`,
  );
}

test('overview orders current suggestions, badges own popular entries, preserves dimmed decisions and warns in frozen preview under network audit', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreFeed(page);
  const feed = page.getByTestId('review-overview');
  const cards = feed.getByTestId('feed-card');
  expect(
    await cards.evaluateAll((entries) =>
      entries.map((entry) => entry.getAttribute('data-item-id')),
    ),
  ).toEqual(feedExpected.order);
  await expect(feed).toContainText('from 8 likes');
  const popular = feed.locator(`li[data-item-id="${feedExpected.popular[0]}"]`);
  await expect(popular.getByTestId('popular-badge')).toHaveText(
    'popular with you · 13',
  );
  await expect(feed.getByTestId('popular-badge')).toHaveCount(2);
  await expect(popular.locator('blockquote')).toHaveText(feedExpected.quote);
  await expect(popular).toContainText('Generated suggestion for feed 19.');
  const first = cards.first();
  await first.getByRole('button', { name: 'Keep K', exact: true }).click();
  await expect(first).toHaveAttribute('data-decided', 'true');
  await expect(feed.getByTestId('feed-count')).toHaveText('1 of 6 decided');
  await expect(cards).toHaveCount(6);
  const kept = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    feedExpected.order[0],
  );
  expect(kept.type).toBe('itemDetail');
  if (kept.type !== 'itemDetail') throw new Error('No fixture detail');
  expect(kept.events.at(-1)).toMatchObject({
    value: 'keep',
    source: { kind: 'human', via: 'web-review' },
  });
  await cards.nth(1).focus();
  await page.keyboard.press('j');
  await expect(cards.nth(1)).toHaveAttribute('data-decided', 'true');
  await expect(feed.getByTestId('feed-count')).toHaveText('2 of 6 decided');
  await cards.nth(2).focus();
  await page.keyboard.press('l');
  await expect(feed.getByTestId('feed-count')).toHaveText('3 of 6 decided');
  await cards.nth(2).focus();
  await page.keyboard.press('u');
  await expect(feed.getByTestId('feed-count')).toHaveText('2 of 6 decided');
  await expect(cards.nth(2)).toHaveAttribute('data-decided', 'false');
  await feed
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('bulk-popular-count')).toHaveText(
    '2 popular entries are left out. Decide on them one by one.',
  );
  expect(
    await dialog.getByRole('heading').evaluate((heading) => {
      const box = heading.getBoundingClientRect();
      return !!document
        .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        ?.closest('[role="dialog"]');
    }),
  ).toBe(true);
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 2 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(first).toHaveAttribute('data-decided', 'true');
  await popular.getByRole('button', { name: 'Keep K', exact: true }).click();
  await feed
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  await expect(dialog.getByTestId('bulk-popular-count')).toHaveText(
    '1 popular entry is left out. Decide on them one by one.',
  );
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByTestId('bulk-popular-count')).toHaveText(
    '2 popular entries are left out. Decide on them one by one.',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await checkAccessibility(page, context);
  await audit.assert();
});

test('large overview virtualizes and counts popular preview entries beyond its sample under network audit', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreFeed(page, largeFeedFixture(), 100);
  const feed = page.getByTestId('review-overview');
  await expect(feed.getByTestId('feed-card').first()).toHaveAttribute(
    'data-item-id',
    'x:large-feed-0099',
  );
  expect(await feed.getByTestId('feed-card').count()).toBeLessThan(30);
  await expect(feed).toContainText('from 90 likes');
  await feed
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('bulk-popular-count')).toHaveText(
    '10 popular entries are left out. Decide on them one by one.',
  );
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 90 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await feed.locator('ul').evaluate((list) => {
    list.parentElement!.scrollTop = list.parentElement!.scrollHeight;
  });
  await expect(
    feed.locator('li[data-item-id="x:large-feed-0000"]'),
  ).toBeVisible();
  expect(await feed.getByTestId('feed-card').count()).toBeLessThan(30);
  await feed.locator('li[data-item-id="x:large-feed-0000"]').focus();
  await page.keyboard.press('k');
  await expect(feed.getByTestId('feed-count')).toHaveText('1 of 100 decided');
  await expect(
    feed.locator('li[data-item-id="x:large-feed-0000"]'),
  ).toHaveAttribute('data-decided', 'true');
  await audit.assert();
});

test('overview consumes and writes account filter search sort, mode stays local and Instagram is not popular', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const data = feedFixture();
  data.settings.review!.search = 'Generated feed';
  await restoreFeed(page, data);
  const feed = page.getByTestId('review-overview');
  const search = feed.getByRole('searchbox', {
    name: 'Search the text',
    exact: true,
  });
  await expect(search).toHaveValue('Generated feed');
  await feed
    .getByRole('combobox', { name: 'Sort by', exact: true })
    .selectOption('createdAt');
  await expect(feed.getByTestId('feed-card').first()).toHaveAttribute(
    'data-item-id',
    feedExpected.newest,
  );
  await search.fill('feed 19:');
  await expect(feed.getByTestId('feed-card')).toHaveCount(1);
  await expect
    .poll(async () => {
      const result = await page.evaluate(() => window.workspace.open());
      return result.type === 'opened' ? result.summary.review?.search : null;
    })
    .toBe('feed 19:');
  await page.reload();
  await expect(page.getByTestId('review-card')).toBeVisible();
  await expect(feed).toHaveCount(0);
  await page
    .getByTestId('card-review')
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await expect(search).toHaveValue('feed 19:');
  await expect(
    feed.getByRole('combobox', { name: 'Sort by', exact: true }),
  ).toHaveValue('createdAt');
  await expect(feed.getByTestId('feed-card')).toHaveCount(1);
  await search.fill('');
  await feed
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption('synthetic-comment');
  await expect(feed.getByTestId('feed-card')).toHaveCount(1);
  await expect(feed.getByTestId('feed-card')).toContainText(
    'Invented Instagram comment.',
  );
  await expect(feed.getByTestId('popular-badge')).toHaveCount(0);
  await expect(feed).not.toContainText('from 8 likes');
  await expect
    .poll(async () => {
      const result = await page.evaluate(() => window.workspace.open());
      return result.type === 'opened'
        ? result.summary.review?.accountKey
        : null;
    })
    .toBe('synthetic-comment');
  await audit.assert();
});

test('list bulk preview retains existing query and human confirmation while adding the popular count', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreFeed(page);
  await page.goto('/socialprune/#/review/list');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('row').first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('bulk-popular-count')).toHaveText(
    '2 popular entries are left out. Decide on them one by one.',
  );
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 4 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole('button', { name: 'Mark for deletion: 4 entries', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const reply = await page.evaluate(() => window.workspace.open());
      return reply.type === 'opened' ? reply.summary.decisions.delete : -1;
    })
    .toBe(4);
  for (const itemId of feedExpected.popular) {
    const detail = await page.evaluate(
      (id) =>
        window.workspace.request({
          type: 'detail',
          requestId: crypto.randomUUID(),
          itemId: id,
        }),
      itemId,
    );
    expect(detail.type).toBe('itemDetail');
    if (detail.type !== 'itemDetail')
      throw new Error('Missing popular fixture');
    expect(detail.events).toEqual([]);
  }
  await page.goto('/socialprune/#/review');
  await expect(page.getByTestId('review-card')).toBeVisible();
  await page
    .getByTestId('card-review')
    .getByRole('button', { name: 'All', exact: true })
    .click();
  const feed = page.getByTestId('review-overview');
  await expect(feed.getByTestId('popular-waiting-count')).toHaveText(
    '2 popular entries still wait',
  );
  await feed
    .getByRole('checkbox', {
      name: 'Only popular undecided entries',
      exact: true,
    })
    .check();
  await expect(feed.getByTestId('feed-card')).toHaveCount(2);
  await feed
    .getByTestId('feed-card')
    .first()
    .getByRole('button', { name: 'Keep K', exact: true })
    .click();
  await expect(feed.getByTestId('popular-waiting-count')).toHaveText(
    '1 popular entry still waits',
  );
  await expect(feed.getByTestId('feed-card')).toHaveCount(1);
  await audit.assert();
});
