import { test, expect } from '@playwright/test';
import {
  fixtureZips,
  importFiles,
  observeImport,
  waitForApp,
} from './helpers.ts';
import { restoreReview, reviewFixture } from './review-fixture.ts';

test('W2a an imported archive reaches a keyboard-only review without suggestions', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const link = page
      .getByTestId('app-menu')
      .getByRole('link', { name: 'List view', exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    const grid = page.getByRole('grid');
    await expect(grid).toBeVisible();
    await expect(page.getByRole('row').first()).toBeVisible();
    await grid.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(
        'No suggestion for this entry. Read it and decide what you want to do with it.',
      ),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(grid).toBeFocused();
    await page.keyboard.press('m');
    await expect(
      page.getByText('1 decision saved. Nothing was deleted on the platform.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.getByRole('row').first().innerText()).toContain(
      'Marked for deletion',
    );
    await page.keyboard.press('Control+z');
    await expect(
      page.getByText(
        '1 entry changed. 0 entries were skipped because their state changed.',
        { exact: true },
      ),
    ).toBeVisible();
    await audit.assert();
  } finally {
    await fixture.cleanup();
  }
});

test('W2a focus and selection never decide; grid-only letters, detail and durable undo are real commands', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const fixture = await restoreReview(page);
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('ArrowDown');
  expect(await grid.getAttribute('aria-activedescendant')).toBe(
    'review-cell-1',
  );
  await page.keyboard.press('Space');
  await expect(page.getByRole('row').nth(1)).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    await page.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'detail',
          requestId: crypto.randomUUID(),
          itemId,
        }),
      fixture.items[1]!.id,
    ),
  ).toMatchObject({ type: 'itemDetail', events: [] });
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  await page.getByRole('searchbox').fill('m');
  expect(
    await page.evaluate(() =>
      window.workspace.request({
        type: 'history',
        requestId: crypto.randomUUID(),
        limit: 50,
      }),
    ),
  ).toMatchObject({ type: 'historyEntries', entries: [] });
  await page.getByRole('searchbox').fill('');
  await expect(
    page.getByText('8 entries in this view', { exact: true }),
  ).toBeVisible();
  await grid.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Entry details', exact: true }),
  ).toBeVisible();
  await expect(page.locator('mark')).toHaveText('café note');
  await expect(
    page.getByRole('region', { name: 'Entry details' }),
  ).toContainText('Agent: Synthetic reviewer');
  expect(
    await page.evaluate(() => Reflect.get(globalThis, '__pwned') as unknown),
  ).toBeUndefined();
  await page.getByRole('button', { name: 'Keep K', exact: true }).click();
  await expect(
    page.getByText('1 decision saved. Nothing was deleted on the platform.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(grid).toBeFocused();
  await page.reload();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1 entry: Keep');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
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
    events: [
      { value: 'keep' },
      { value: 'undecided', action: { kind: 'undo' } },
    ],
  });
  await audit.assert();
});

test('W2a keyboard setting, modal focus return and paged list preserve row decisions', async ({
  page,
}) => {
  const fixture = await restoreReview(page, reviewFixture('personal', false));
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('button', { name: 'Toggle single-key shortcuts' })
    .click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(grid).toBeFocused();
  await page.keyboard.press('m');
  expect(
    await page.evaluate(() =>
      window.workspace.request({
        type: 'history',
        requestId: crypto.randomUUID(),
        limit: 50,
      }),
    ),
  ).toMatchObject({ type: 'historyEntries', entries: [] });
  await page.getByRole('button', { name: 'Paged list', exact: true }).click();
  await expect(
    page.getByRole('list').filter({
      has: page.getByRole('button', { name: 'Open details', exact: true }),
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Open details', exact: true })
    .first()
    .click();
  await expect(
    page.getByText(
      'No suggestion for this entry. Read it and decide what you want to do with it.',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'detail',
          requestId: crypto.randomUUID(),
          itemId,
        }),
      fixture.items[0]!.id,
    ),
  ).toMatchObject({ type: 'itemDetail', events: [] });
});

test('W2a example badges appear only on a restored demo workspace', async ({
  page,
}) => {
  await restoreReview(page, reviewFixture('demo'));
  await expect(
    page.getByText(
      'Made-up posts. Suggestions are examples, not classifier results.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('grid').getByText('Example', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('grid').focus();
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'Entry details' })
      .getByText('Example', { exact: true }),
  ).toBeVisible();
});

test('W2a recycled rows keep a valid active descendant and bounded page memory', async ({
  page,
}) => {
  await restoreReview(page, reviewFixture('personal', false, 600));
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('End');
  await expect(grid).toHaveAttribute(
    'aria-activedescendant',
    'review-cell-599',
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const grid = document.querySelector('[role="grid"]');
        const active = grid?.getAttribute('aria-activedescendant');
        return active ? document.getElementById(active)?.textContent : null;
      }),
    )
    .toBeTruthy();
  expect(await page.getByRole('row').count()).toBeLessThan(30);
  expect(
    await page.evaluate(() => window.workspace.rows.length),
  ).toBeLessThanOrEqual(200);
  await page.keyboard.press('Home');
  await expect(grid).toHaveAttribute('aria-activedescendant', 'review-cell-0');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByRole('row').nth(0)).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('row').nth(1)).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const before = await page.evaluate(() =>
    window.workspace.request({
      type: 'history',
      requestId: crypto.randomUUID(),
      limit: 50,
    }),
  );
  expect(before).toMatchObject({ type: 'historyEntries', entries: [] });
});

test('W2a a delayed bottom window cannot replace the settled Home rows', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = {
      armed: false,
      bottomOffset: null as number | null,
      requestId: null as string | null,
      held: false,
      released: false,
      delivered: false,
    };
    let held: { worker: Worker; data: unknown } | null = null;
    Reflect.set(globalThis, '__reviewWindowHold', {
      state,
      release() {
        if (!held) throw new Error('No bottom-window reply was held.');
        state.released = true;
        held.worker.dispatchEvent(
          new MessageEvent('message', { data: held.data }),
        );
        held = null;
      },
    });
    const WorkerClass = Worker;
    globalThis.Worker = class extends WorkerClass {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        // Register before the client so the real reply can arrive out of order.
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const value = event.data as { type?: string; requestId?: string };
          if (value.type !== 'rows' || value.requestId !== state.requestId)
            return;
          if (state.released) {
            state.delivered = true;
            return;
          }
          event.stopImmediatePropagation();
          held = { worker: this, data: event.data };
          state.held = true;
        });
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const value = message as {
          type?: string;
          requestId?: string;
          offset?: number;
        };
        if (value.type === 'window' && value.offset && value.requestId) {
          state.bottomOffset ??= value.offset;
          if (
            state.armed &&
            value.offset === state.bottomOffset &&
            !state.requestId
          )
            state.requestId = value.requestId;
        }
        super.postMessage(
          message,
          Array.isArray(options) ? options : (options?.transfer ?? []),
        );
      }
    };
  });
  const fixture = reviewFixture('personal', false, 600);
  // Equal dates make the input's ID order the expected row order.
  for (const item of fixture.items) item.createdAt = fixture.createdAt;
  await restoreReview(page, fixture);
  const grid = page.getByRole('grid');
  const first = grid.locator('[role="row"][data-index="0"]');
  const second = grid.locator('[role="row"][data-index="1"]');
  const holdState = () =>
    page.evaluate(() => {
      const hold = Reflect.get(globalThis, '__reviewWindowHold') as {
        state: { held: boolean; delivered: boolean };
      };
      return { held: hold.state.held, delivered: hold.state.delivered };
    });
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await grid.focus();
  await page.keyboard.press('End');
  await expect(grid).toHaveAttribute(
    'aria-activedescendant',
    'review-cell-599',
  );
  await page.keyboard.press('Home');
  await expect(grid).toHaveAttribute('aria-activedescendant', 'review-cell-0');
  await expect(second).toBeAttached();
  await frames();
  // Hold a scroll-driven window, not End's asynchronous focus continuation.
  await page.evaluate(() => {
    const hold = Reflect.get(globalThis, '__reviewWindowHold') as {
      state: { armed: boolean };
    };
    hold.state.armed = true;
  });
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(async () => (await holdState()).held).toBe(true);
  await page.keyboard.press('Home');
  await expect(grid).toHaveAttribute('aria-activedescendant', 'review-cell-0');
  await expect(first).toContainText(fixture.items[0]!.text);
  await expect(second).toBeAttached();
  await expect
    .poll(() => grid.evaluate((element) => element.scrollTop))
    .toBe(0);
  await frames();
  await page.evaluate(() => {
    const hold = Reflect.get(globalThis, '__reviewWindowHold') as {
      release(): void;
    };
    hold.release();
  });
  await expect.poll(async () => (await holdState()).delivered).toBe(true);
  await frames();
  await expect(first).toBeAttached();
  await expect(second).toBeAttached();
  await expect(grid).toHaveAttribute('aria-activedescendant', 'review-cell-0');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(grid).toHaveAttribute('aria-activedescendant', 'review-cell-1');
  await expect(grid.locator('#review-cell-1')).toBeAttached();
});

test('W2a visible searching state follows a delayed query and rejects a stale reply', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const WorkerClass = Worker;
    globalThis.Worker = class extends WorkerClass {
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const transfer = Array.isArray(options)
          ? options
          : (options?.transfer ?? []);
        const value = message as { type?: string; search?: string };
        if (value.type === 'query' && value.search === 'café')
          setTimeout(() => super.postMessage(message, transfer ?? []), 300);
        else super.postMessage(message, transfer ?? []);
      }
    };
  });
  await restoreReview(page);
  await page.getByRole('searchbox').fill('café');
  await expect(page.getByText('Searching...', { exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('entry 7');
  await expect(
    page.getByText('1 entry in this view', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(1);
  await expect(page.getByRole('row')).toContainText('Invented review entry 7');
  await page.waitForTimeout(350);
  await expect(page.getByRole('row')).toContainText('Invented review entry 7');
});

test('W2a cached rows refresh after another tab and undo reverses the latest durable action', async ({
  page,
  context,
}) => {
  const fixture = await restoreReview(page);
  const firstId = fixture.items[0]!.id;
  const second = await context.newPage();
  try {
    await page.getByRole('grid').focus();
    await page.keyboard.press('k');
    await expect(page.getByRole('row').first()).toContainText('Keep');
    await second.goto('/socialprune/#/review/list');
    await expect(second.getByRole('grid')).toBeVisible();
    await expect(second.getByRole('row').first()).toContainText('Keep');
    await second.getByRole('grid').focus();
    await second.keyboard.press('l');
    await expect(page.getByRole('row').first()).toContainText('Later');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByText(
        '1 entry changed. 0 entries were skipped because their state changed.',
        { exact: true },
      ),
    ).toBeVisible();
    const detail = await page.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'detail',
          requestId: crypto.randomUUID(),
          itemId,
        }),
      firstId,
    );
    expect(detail).toMatchObject({
      type: 'itemDetail',
      events: [
        { value: 'keep' },
        { value: 'later' },
        { value: 'keep', action: { kind: 'undo' } },
      ],
    });
  } finally {
    await second.close();
  }
});
