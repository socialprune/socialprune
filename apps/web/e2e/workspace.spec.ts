import { test, expect } from '@playwright/test';
import {
  fixtureZips,
  importFiles,
  observeImport,
  waitForApp,
  workspaceIds,
} from './helpers.ts';

test('W1 windows only, idempotent commands, expected guard and durable history after reopen', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    const first = fixture.expected.items[0]!.id;
    const results = await page.evaluate(async (itemId) => {
      const input = {
        type: 'decide' as const,
        requestId: 'first',
        commandId: 'decision-command',
        itemIds: [itemId],
        value: 'delete' as const,
        expected: { [itemId]: 'undecided' as const },
      };
      const committed = await window.workspace.request(input);
      const replay = await window.workspace.request({
        ...input,
        requestId: 'replay',
      });
      const stale = await window.workspace.request({
        ...input,
        requestId: 'stale',
        commandId: 'stale-command',
        value: 'keep',
      });
      const history = await window.workspace.request({
        type: 'history',
        requestId: 'history',
        limit: 50,
      });
      return {
        committed,
        replay,
        stale,
        history,
        rows: window.workspace.rows.length,
        pageItems: window.socialprune.getImportSnapshot().items.length,
      };
    }, first);
    expect(results.committed).toMatchObject({ type: 'committed', changed: 1 });
    expect(results.replay).toMatchObject({
      ...results.committed,
      requestId: 'replay',
    });
    expect(results.stale).toMatchObject({ type: 'rejected', code: 'STALE' });
    expect(results.history.type).toBe('historyEntries');
    expect(results.rows).toBeLessThanOrEqual(200);
    expect(results.pageItems).toBe(0);
    await page.reload();
    await expect(page.getByTestId('import-state')).toHaveAttribute(
      'data-phase',
      'idle',
    );
    expect(await workspaceIds(page)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    const detail = await page.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'detail',
          requestId: 'detail',
          itemId,
        }),
      first,
    );
    expect(detail).toMatchObject({
      type: 'itemDetail',
      events: [
        {
          itemId: first,
          value: 'delete',
          source: { kind: 'human', via: 'web-review' },
        },
      ],
    });
    await audit.assert();
  } finally {
    await fixture.cleanup();
  }
});

test('W1 page drops superseded query responses and retains only the latest window', async ({
  page,
}) => {
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    const account = fixture.expected.items[0]!.account.key;
    const result = await page.evaluate(async (accountKey) => {
      const base = {
        type: 'query' as const,
        queryId: 'changing-query',
        accountKey,
        filter: {},
        sort: [{ by: 'id' as const, direction: 'asc' as const }],
        search: '',
      };
      const first = window.workspace.request({
        ...base,
        requestId: 'generation-one',
        generation: 1,
      });
      const second = window.workspace.request({
        ...base,
        requestId: 'generation-two',
        generation: 2,
      });
      const old = await first,
        latest = await second;
      const rows = await window.workspace.request({
        type: 'window',
        requestId: 'latest-rows',
        queryId: base.queryId,
        generation: 2,
        offset: 0,
        limit: 200,
      });
      return { old, latest, window: rows };
    }, account);
    expect(result.old).toMatchObject({ type: 'cancelled', generation: 1 });
    expect(result.latest).toMatchObject({
      type: 'queryResult',
      generation: 2,
      total: fixture.expected.items.length,
    });
    expect(result.window).toMatchObject({ type: 'rows', generation: 2 });
  } finally {
    await fixture.cleanup();
  }
});

test('W1 bulk preview is page-bound, stale on another-tab decision and released on reopen', async ({
  page,
  context,
}) => {
  const fixture = await fixtureZips('x', 'current-minimal');
  const second = await context.newPage();
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    await waitForApp(second);
    const account = fixture.expected.items[0]!.account.key,
      firstId = fixture.expected.items[0]!.id;
    const preview = await page.evaluate(async (accountKey) => {
      await window.workspace.request({
        type: 'query',
        requestId: 'preview-query',
        queryId: 'preview-list',
        generation: 1,
        accountKey,
        filter: {},
        sort: [{ by: 'id', direction: 'asc' }],
        search: '',
      });
      return window.workspace.request({
        type: 'previewBulk',
        requestId: 'preview',
        pageId: 'first-page',
        previewId: 'frozen-preview',
        queryId: 'preview-list',
        generation: 1,
        value: 'delete',
        overwrite: ['undecided', 'later'],
      });
    }, account);
    expect(preview).toMatchObject({
      type: 'bulkPreview',
      total: fixture.expected.items.length,
      willChange: fixture.expected.items.length,
    });
    await second.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'decide',
          requestId: 'other-decision',
          commandId: 'other-command',
          itemIds: [itemId],
          value: 'keep',
          expected: { [itemId]: 'undecided' },
        }),
      firstId,
    );
    const stale = await page.evaluate(() =>
      window.workspace.request({
        type: 'confirmBulk',
        requestId: 'confirm-stale',
        commandId: 'stale-preview-command',
        pageId: 'first-page',
        previewId: 'frozen-preview',
      }),
    );
    expect(stale).toMatchObject({
      type: 'rejected',
      code: 'STALE_PREVIEW',
      changedSince: 1,
    });
    await page.evaluate(async (accountKey) => {
      await window.workspace.request({
        type: 'query',
        requestId: 'query-again',
        queryId: 'preview-list',
        generation: 2,
        accountKey,
        filter: {},
        sort: [{ by: 'id', direction: 'asc' }],
        search: '',
      });
      await window.workspace.request({
        type: 'previewBulk',
        requestId: 'preview-again',
        pageId: 'first-page',
        previewId: 'abandoned-preview',
        queryId: 'preview-list',
        generation: 2,
        value: 'delete',
        overwrite: ['undecided'],
      });
      await window.workspace.open();
    }, account);
    const expired = await page.evaluate(() =>
      window.workspace.request({
        type: 'confirmBulk',
        requestId: 'confirm-reopen',
        commandId: 'expired-command',
        pageId: 'first-page',
        previewId: 'abandoned-preview',
      }),
    );
    expect(expired).toMatchObject({
      type: 'rejected',
      code: 'PREVIEW_EXPIRED',
    });
  } finally {
    await second.close();
    await fixture.cleanup();
  }
});
