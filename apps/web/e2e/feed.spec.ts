import { expect, test } from '@playwright/test';
import {
  restoreLiveFeed,
  liveExpected,
  liveFeedFixture,
} from './feed-fixture.ts';
import { observeImport } from './helpers.ts';
import { checkAccessibility } from './accessibility.ts';

test('all six real-service tabs, local decision states and counted human plan under network audit', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await restoreLiveFeed(page);
  const feed = page.getByRole('feed');
  await expect(page.locator('main h1')).toHaveCount(1);
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
  const heldInAll = feed.locator(
    `article[data-item-id="${liveExpected.held[0]}"]`,
  );
  await expect(
    heldInAll.getByRole('button', { name: /Mark anyway/ }),
  ).toBeVisible();
  await heldInAll.getByRole('button', { name: /Mark anyway/ }).click();
  await expect(heldInAll).toHaveAttribute('data-decision', 'delete');
  await heldInAll.focus();
  await page.keyboard.press('u');
  await expect(heldInAll).toHaveAttribute('data-decision', 'undecided');
  await page.getByRole('tab', { name: /^Suggested for deletion,/ }).click();
  const first = feed.locator('article').first();
  await first.focus();
  await page.keyboard.press('j');
  await expect(first).toHaveAttribute('data-decision', 'undecided');
  await page.keyboard.press('k');
  await expect(first).toHaveAttribute('data-decision', 'keep');
  await expect(first).toBeFocused();
  await expect(
    page.getByRole('tab', { name: /^Suggested for deletion,/ }),
  ).toHaveAccessibleName('Suggested for deletion, 2 entries');
  await feed.locator('article').nth(1).focus();
  await page.keyboard.press('l');
  await expect(feed.locator('article').nth(1)).toHaveAttribute(
    'data-decision',
    'later',
  );
  await page
    .getByRole('button', { name: 'Mark 1 entry for deletion', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The 3 under Unclear stay as they are.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Mark 1 entry for deletion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Mark 1 entry', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(
    'Marked, 2 entries',
  );
  const plans = await page.evaluate(async () => {
    let text = '';
    await window.workspace.backup(async (file) => {
      text = await file.text();
    });
    return JSON.parse(text) as import('@socialprune/core').WorkspaceV2;
  });
  expect(plans.reviewPlans).toHaveLength(1);
  expect(
    plans.decisionEvents
      .filter((event) => event.action.id === plans.reviewPlans![0]!.actionId)
      .map((event) => event.itemId),
  ).toEqual(['x:feed-3']);
  await checkAccessibility(page, context);
  await audit.assert();
});

test('bounded card windows, full-query keyboard jumps and persisted tab anchor', async ({
  page,
}) => {
  await restoreLiveFeed(page, liveFeedFixture(650));
  const feed = page.getByRole('feed');
  await expect(feed.locator('article').first()).toBeVisible();
  expect(await feed.locator('article').count()).toBeLessThanOrEqual(30);
  await feed.locator('article').first().focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => page.locator('article:focus').getAttribute('aria-posinset'))
    .toBe('648');
  expect(await feed.locator('article').count()).toBeLessThanOrEqual(300);
  await page.keyboard.press('Home');
  await expect
    .poll(() => page.locator('article:focus').getAttribute('aria-posinset'))
    .toBe('1');
  // Delay the next service window, then send Home while that read is pending.
  // This is an injected test dependency, not a production delay control.
  await page.evaluate(() => {
    const original = window.workspace.feedWindow.bind(window.workspace);
    let release: (() => void) | undefined;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    Reflect.set(window, '__releaseFeedRead', release);
    window.workspace.feedWindow = async (input) => {
      if (input.offset && input.offset > 0) {
        Reflect.set(window, '__feedReadPending', true);
        await deferred;
      }
      return original(input);
    };
  });
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, '__feedReadPending') === true),
    )
    .toBe(true);
  await page.keyboard.press('Home');
  await expect
    .poll(() => page.locator('article:focus').getAttribute('aria-posinset'))
    .toBe('1');
  await page.evaluate(() =>
    (Reflect.get(window, '__releaseFeedRead') as () => void)(),
  );
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(() => page.locator('article:focus').getAttribute('aria-posinset'))
    .toBe('1');
  await page.getByRole('tab', { name: /^All,/ }).click();
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await feed
    .locator('article')
    .nth(10)
    .evaluate((article) => article.scrollIntoView({ block: 'start' }));
  let savedAnchor: string | undefined;
  await expect
    .poll(async () => {
      const result = await page.evaluate(() => window.workspace.open());
      savedAnchor =
        result.type === 'opened'
          ? result.summary.review?.feed?.anchors.all
          : undefined;
      return savedAnchor;
    })
    .toBeTruthy();
  await page.reload();
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(
    'All, 650 entries',
  );
  await expect(feed.locator('article').first()).toHaveAttribute(
    'data-item-id',
    savedAnchor!,
  );
  await feed.locator('article').first().focus();
  await page.keyboard.press('Control+End');
  await expect(page.getByRole('tabpanel')).toBeFocused();
  await feed.locator('article').first().focus();
  await page.keyboard.press('Control+Home');
  await expect(
    page.getByRole('heading', { name: 'Review', exact: true }).last(),
  ).toBeFocused();
});

test('a virtual keyboard destination is acknowledged only after focus survives its layout frame', async ({
  page,
}) => {
  await restoreLiveFeed(page, liveFeedFixture(650));
  await page.getByRole('feed').locator('article').first().focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => page.locator('article:focus').getAttribute('aria-posinset'))
    .toBe('648');
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'focus',
    )!;
    const focus = Reflect.apply.bind(
      null,
      original.value as (this: HTMLElement, options?: FocusOptions) => void,
    );
    HTMLElement.prototype.focus = function (...args) {
      if (this.getAttribute('data-card-id') === 'x:feed-1') {
        Object.defineProperty(HTMLElement.prototype, 'focus', original);
        // One transient non-focusable layout frame, injected by this test only.
        this.style.display = 'none';
        focus(this, args);
        this.style.removeProperty('display');
        return;
      }
      focus(this, args);
    };
  });
  await page.keyboard.press('Home');
  await expect
    .poll(() => page.locator('article:focus').getAttribute('aria-posinset'))
    .toBe('1');
});

test('sequential keyboard traversal crosses generated fifty-card window boundaries without losing visibility', async ({
  page,
}) => {
  // On the loaded Windows host of 2026-10-25, the unchanged baseline needed
  // 108s and the new geometry reached card499 at120s. The per-card visibility
  // budget stays5s; this is the total budget for600 real keys and two frames each.
  test.setTimeout(360_000);
  const data = liveFeedFixture(650);
  data.settings.keepRules = [];
  const expected = data.items
    .filter((item) => item.platform === 'x' && item.id !== 'x:feed-6')
    .map((item) => item.id);
  await restoreLiveFeed(page, data);
  await page.getByRole('feed').locator('article').first().focus();
  for (const [index, id] of expected.slice(0, 600).entries()) {
    if (index) await page.keyboard.press('ArrowDown');
    await page
      .waitForFunction(
        (id) => {
          const article = document.activeElement;
          const panel = document.querySelector('[role="tabpanel"]');
          if (!(article instanceof HTMLElement) || !panel) return false;
          const box = article.getBoundingClientRect(),
            bounds = panel.getBoundingClientRect();
          return (
            article.dataset['cardId'] === id &&
            box.bottom > bounds.top &&
            box.top < bounds.bottom &&
            document
              .querySelector('[role="feed"]')
              ?.getAttribute('aria-busy') === 'false'
          );
        },
        id,
        { timeout: 5000 },
      )
      .catch(async (error: unknown) => {
        console.log(
          'FEED_KEYBOARD_GEOMETRY',
          JSON.stringify(
            await page.evaluate((expected) => {
              const panel = document.querySelector('[role="tabpanel"]')!;
              const active = document.activeElement as HTMLElement | null;
              const box = (element: Element | null) => {
                const value = element?.getBoundingClientRect();
                return value
                  ? {
                      top: value.top,
                      bottom: value.bottom,
                      height: value.height,
                    }
                  : null;
              };
              const target = [
                ...document.querySelectorAll<HTMLElement>('article'),
              ].find((article) => article.dataset['cardId'] === expected);
              return {
                expected,
                activeId: active?.dataset['cardId'],
                active: box(active),
                target: box(target ?? null),
                panel: box(panel),
                scrollTop: panel.scrollTop,
                scrollHeight: panel.scrollHeight,
                busy: document
                  .querySelector('[role="feed"]')
                  ?.getAttribute('aria-busy'),
              };
            }, id),
          ),
        );
        throw error;
      });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
});

test('keyboard movement does not reformat dates of every retained mounted card', async ({
  page,
}) => {
  await restoreLiveFeed(page, liveFeedFixture(400));
  await page.getByRole('feed').locator('article').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('article:focus')).toHaveAttribute(
    'aria-posinset',
    '2',
  );
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(
      Intl.DateTimeFormat.prototype,
      'format',
    )!;
    Reflect.set(window, '__feedDateFormats', 0);
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      ...original,
      get() {
        const format = original.get!.call(this) as (
          ...args: unknown[]
        ) => string;
        return (...args: unknown[]) => {
          Reflect.set(
            window,
            '__feedDateFormats',
            (Reflect.get(window, '__feedDateFormats') as number) + 1,
          );
          return format(...args);
        };
      },
    });
  });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('article:focus')).toHaveAttribute(
    'aria-posinset',
    '3',
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const formats = await page.evaluate(
    () => Reflect.get(window, '__feedDateFormats') as number,
  );
  console.log('M2_DATE_FORMAT_CALLS', formats);
  expect(formats).toBeLessThanOrEqual(4);
});

test('a second page makes the plan stale; the changed preview requires another human confirmation', async ({
  page,
  context,
}) => {
  await restoreLiveFeed(page);
  await page.locator('footer button').click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Mark 3 entries', exact: true }),
  ).toBeEnabled();
  const second = await context.newPage();
  await second.goto('/socialprune/#/review');
  await expect(
    second.getByRole('feed').locator('article').first(),
  ).toBeVisible();
  await second.getByRole('feed').locator('article').first().focus();
  await second.keyboard.press('k');
  await expect(
    second.getByRole('feed').locator('article').first(),
  ).toHaveAttribute('data-decision', 'keep');
  await dialog
    .getByRole('button', { name: 'Mark 3 entries', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText(
    'New suggestions or changes arrived',
  );
  await expect(
    dialog.getByRole('button', { name: 'Mark 2 entries', exact: true }),
  ).toBeEnabled();
  const before = await page.evaluate(async () => {
    let text = '';
    await window.workspace.backup(async (file) => {
      text = await file.text();
    });
    return JSON.parse(text) as import('@socialprune/core').WorkspaceV2;
  });
  expect(before.reviewPlans).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await second.close();
});

test('new workspace first start and Instagram plan use the real shared settings and platform path', async ({
  page,
  context,
}) => {
  const data = liveFeedFixture();
  data.settings.criteria!.selected = [];
  await restoreLiveFeed(page, data);
  await expect(
    page.getByRole('heading', { name: 'Choose first what should go.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Choose criteria', exact: true })
    .click();
  await page
    .getByRole('checkbox', { name: /Political/ })
    .first()
    .check();
  await page
    .getByRole('button', { name: 'Use these criteria', exact: true })
    .click();
  await expect(page.getByRole('tab', { selected: true })).toBeFocused();
  await expect(page.getByRole('feed').locator('article').first()).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption(liveExpected.instagram);
  await expect(page.getByRole('feed')).toContainText('Invented comment');
  await expect(page.getByRole('feed')).toContainText(
    'Instagram does not include the post.',
  );
  await expect(page.getByRole('feed')).not.toContainText('reposts');
  await expect(page.getByRole('feed')).not.toContainText('Likes:');
  await checkAccessibility(page, context);
  await page
    .getByRole('button', { name: 'Mark 2 entries for deletion', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'You delete them afterwards with the click list.',
  );
});

test('feed undo and keyboard-only final mark retain human decisions in German dark at 320 px', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('sp-locale', 'de');
    localStorage.setItem('sp-theme', 'dark');
  });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await restoreLiveFeed(page);
  const card = page.getByRole('feed').locator('article').first();
  await expect(card).toBeVisible();
  await checkAccessibility(page, context);
  await card.focus();
  await page.keyboard.press('k');
  await expect(card).toHaveAttribute('data-decision', 'keep');
  await page.keyboard.press('Control+z');
  const restored = page.getByRole('feed').locator('article').first();
  await expect(restored).toHaveAttribute('data-decision', 'undecided');
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(
    'Löschvorschläge, 3 Einträge',
  );
  await restored.focus();
  await page.keyboard.press('Control+End');
  const mark = page.locator('footer button');
  await expect(mark).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await checkAccessibility(page, context);
  const confirm = dialog.getByRole('button', {
    name: '3 Einträge vormerken',
    exact: true,
  });
  for (
    let n = 0;
    n < 12 &&
    !(await confirm.evaluate((element) => element === document.activeElement));
    n++
  )
    await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(
    'Vorgemerkt, 4 Einträge',
  );
});
