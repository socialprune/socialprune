import { test, expect } from '@playwright/test';
import { observeImport } from './helpers.ts';
import { restoreReview, reviewFixture } from './review-fixture.ts';

test('mark suggested entries only prepares the Medium-or-High current suggestions with default decisions', async ({
  page,
}) => {
  const workspace = await restoreReview(page);
  await page
    .getByRole('button', { name: 'Mark suggested entries', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('button', {
      name: 'Mark for deletion: 1 entry',
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.getByRole('dialog')).toContainText(
    'Current suggestions with risk Medium or High',
  );
  await page
    .getByText('First 1 entry in this preview', { exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Agent: Synthetic reviewer',
  );
  const detail = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    workspace.items[0]!.id,
  );
  expect(detail).toMatchObject({ type: 'itemDetail', events: [] });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
});

test('bulk preview names exact changes, keeps existing decisions and replaces stale and expired previews', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const fixture = await restoreReview(page, reviewFixture('personal', false));
  await page.evaluate(
    async (ids) => {
      await window.workspace.request({
        type: 'decide',
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        itemIds: [ids[0]!],
        value: 'keep',
        expected: { [ids[0]!]: 'undecided' },
      });
      await window.workspace.request({
        type: 'decide',
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        itemIds: [ids[1]!],
        value: 'delete',
        expected: { [ids[1]!]: 'undecided' },
      });
    },
    fixture.items.map(({ id }) => id),
  );
  await page
    .getByRole('button', {
      name: 'Mark for deletion for all in this view',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 6 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await expect(dialog).toContainText(
    '6 entries will change. 2 entries stay unchanged.',
  );
  expect(
    await page.evaluate(() =>
      window.workspace.request({
        type: 'history',
        requestId: crypto.randomUUID(),
        limit: 50,
      }),
    ),
  ).toMatchObject({ type: 'historyEntries', entries: [{}, {}] });
  await dialog.getByRole('checkbox').check();
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 7 entries',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog.getByRole('checkbox').uncheck();
  await expect(
    dialog.getByRole('button', {
      name: 'Mark for deletion: 6 entries',
      exact: true,
    }),
  ).toBeEnabled();
  const second = await context.newPage();
  try {
    await second.goto('/socialprune/#/import');
    await expect(second.getByTestId('import-state')).toHaveAttribute(
      'data-phase',
      'idle',
    );
    const opened = await second.evaluate(() => window.workspace.open());
    expect(opened).toMatchObject({
      type: 'opened',
      summary: { counts: { items: 8 } },
    });
    const other = await second.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'decide',
          requestId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          itemIds: [itemId],
          value: 'keep',
          expected: { [itemId]: 'undecided' },
        }),
      fixture.items[2]!.id,
    );
    expect(other, JSON.stringify(other)).toMatchObject({
      type: 'committed',
      changed: 1,
    });
    await dialog
      .getByRole('button', {
        name: 'Mark for deletion: 6 entries',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText(
        'Some of these entries changed since the preview. Here is the new preview.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', {
        name: 'Mark for deletion: 5 entries',
        exact: true,
      }),
    ).toBeEnabled();
    await page.evaluate(() => window.workspace.open());
    await dialog
      .getByRole('button', {
        name: 'Mark for deletion: 5 entries',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText(
        'This preview expired. Here is a new preview of the current entries.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', {
        name: 'Mark for deletion: 5 entries',
        exact: true,
      }),
    ).toBeEnabled();
    await dialog
      .getByRole('button', {
        name: 'Mark for deletion: 5 entries',
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(
        '5 decisions saved. Nothing was deleted on the platform.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').first()).toContainText('Keep');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await page.reload();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Redo', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    const keep = await page.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'detail',
          requestId: crypto.randomUUID(),
          itemId,
        }),
      fixture.items[0]!.id,
    );
    expect(keep).toMatchObject({
      type: 'itemDetail',
      events: [{ value: 'keep' }],
    });
    await audit.assert();
  } finally {
    await second.close();
  }
});

test('route exit releases the exact preview instead of leaving an applicable frozen set', async ({
  page,
}) => {
  const requests: { type: string; previewId?: string; pageId?: string }[] = [];
  await page.exposeFunction(
    '__captureReviewRequest',
    (message: { type: string; previewId?: string; pageId?: string }) =>
      requests.push(message),
  );
  await page.addInitScript(() => {
    const OriginalWorker = Worker;
    globalThis.Worker = class extends OriginalWorker {
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const value = message as {
          type?: string;
          previewId?: string;
          pageId?: string;
        };
        if (value.type === 'previewBulk' || value.type === 'releasePreview')
          void (
            Reflect.get(globalThis, '__captureReviewRequest') as (
              value: unknown,
            ) => Promise<void>
          )({
            type: value.type,
            previewId: value.previewId,
            pageId: value.pageId,
          });
        super.postMessage(
          message,
          Array.isArray(options) ? options : (options?.transfer ?? []),
        );
      }
    };
  });
  await restoreReview(page, reviewFixture('personal', false));
  await page
    .getByRole('button', { name: 'Keep for all in this view', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Keep: 8 entries', exact: true }),
  ).toBeEnabled();
  await page.goto('/socialprune/#/privacy');
  await expect
    .poll(() => requests.filter(({ type }) => type === 'releasePreview').length)
    .toBe(1);
  const preview = requests.find(({ type }) => type === 'previewBulk')!;
  expect(requests.find(({ type }) => type === 'releasePreview')).toEqual({
    ...preview,
    type: 'releasePreview',
  });
  const confirm = await page.evaluate(
    (preview) =>
      window.workspace.request({
        type: 'confirmBulk',
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        pageId: preview.pageId!,
        previewId: preview.previewId!,
      }),
    preview,
  );
  expect(confirm).toMatchObject({ type: 'rejected', code: 'PREVIEW_EXPIRED' });
});
