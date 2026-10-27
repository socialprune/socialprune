import { expect, test } from '@playwright/test';
import { restoreLiveFeed, liveExpected } from './feed-fixture.ts';
import { observeImport } from './helpers.ts';

test('a newer focused card supersedes the pending next-card frame before U, even with a queued write', async ({
  page,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('tab', { name: /^All,/ }).click();
  const held = page.locator('article[data-card-id="x:feed-4"]');
  const next = page.locator('article[data-card-id="x:feed-5"]');
  await page.evaluate(() => {
    const frame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    window.requestAnimationFrame = (callback) => {
      frames.set(--sequence, callback);
      return sequence;
    };
    window.cancelAnimationFrame = (id) => {
      if (id < 0) frames.delete(id);
      else cancelFrame(id);
    };
    Reflect.set(window, '__releaseFocusFrames', () => {
      window.requestAnimationFrame = frame;
      window.cancelAnimationFrame = cancelFrame;
      for (const callback of frames.values()) frame(callback);
      frames.clear();
    });
    // Hold the actual command, not the displayed decision. U must enqueue after
    // it without waiting for a receipt or changing the failure-key guard.
    const request = window.workspace.request.bind(window.workspace);
    const writes: { itemId: string; value: string }[] = [];
    Reflect.set(window, '__focusWrites', writes);
    let release: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    Reflect.set(window, '__releaseFocusWrite', () => release());
    window.workspace.request = async (input, transfer) => {
      if (input.type === 'decide') {
        writes.push({ itemId: input.itemIds[0]!, value: input.value });
        if (writes.length === 1) await pending;
      }
      return request(input, transfer);
    };
    const keys: { target: string | undefined; prevented: boolean }[] = [];
    Reflect.set(window, '__focusKeys', keys);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'u')
        keys.push({
          target: (event.target as HTMLElement).dataset['cardId'],
          prevented: event.defaultPrevented,
        });
    });
  });
  try {
    await held.getByRole('button', { name: /Mark anyway/ }).click();
    await expect(held).toHaveAttribute('data-decision', 'delete');
    await expect(next).toBeFocused();
    await held.focus();
    await expect(held).toBeFocused();
    await page.evaluate(async () => {
      (Reflect.get(window, '__releaseFocusFrames') as () => void)();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await page.keyboard.press('u');
    await expect(held).toHaveAttribute('data-decision', 'undecided');
    expect(
      await page.evaluate(
        () =>
          Reflect.get(window, '__focusKeys') as {
            target: string;
            prevented: boolean;
          }[],
      ),
    ).toEqual([{ target: 'x:feed-4', prevented: true }]);
    await expect(next).toHaveAttribute('data-decision', 'keep');
    expect(await page.evaluate(() => window.workspace.commands.pending)).toBe(
      2,
    );
    await page.evaluate(async () => {
      (Reflect.get(window, '__releaseFocusWrite') as () => void)();
      await window.workspace.flushCommands();
    });
    expect(
      await page.evaluate(
        () =>
          Reflect.get(window, '__focusWrites') as {
            itemId: string;
            value: string;
          }[],
      ),
    ).toEqual([
      { itemId: 'x:feed-4', value: 'delete' },
      { itemId: 'x:feed-4', value: 'undecided' },
    ]);
    await expect(held).toHaveAttribute('data-decision', 'undecided');
    await page.reload();
    await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
    // Reload can restore the next-card scroll anchor. Read exact persisted IDs
    // through the real service instead of assuming they are both mounted.
    for (const [id, decision] of [
      ['x:feed-4', 'undecided'],
      ['x:feed-5', 'keep'],
    ] as const) {
      const result = await page.evaluate(
        (anchor) =>
          window.workspace.feedWindow({
            accountKey: 'x:feed',
            tab: 'all',
            anchor,
            limit: 1,
          }),
        id,
      );
      expect(result.type).toBe('feedCards');
      if (result.type === 'feedCards') {
        expect(result.cards[0]?.item.id).toBe(id);
        expect(result.cards[0]?.decision).toBe(decision);
      }
    }
  } finally {
    await page.evaluate(async () => {
      (
        Reflect.get(window, '__releaseFocusFrames') as (() => void) | undefined
      )?.();
      (
        Reflect.get(window, '__releaseFocusWrite') as (() => void) | undefined
      )?.();
      await window.workspace.flushCommands();
    });
  }
});

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
