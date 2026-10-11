import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { running } from './test/helpers.ts';

test('real HTTP local review skips popular own X entries and records only non-popular human bulk decisions', async () => {
  const fixture = await running(20);
  try {
    const store = await SQLiteStore.open(
      join(fixture.workspace, 'socialprune.sqlite'),
    );
    try {
      await store.write(async (tx) => {
        for (let index = 0; index < 20; index++) {
          const stored = (await tx.items.get(`x:${101 + index}`))!;
          stored.item.kind = 'post';
          stored.item.platform = 'x';
          stored.item.engagement.likes = [3, 5, 8, 13][index - 16] ?? 0;
          await tx.items.put(stored);
        }
      });
    } finally {
      await store.close();
    }
    await fixture.authenticate();
    await fixture.api({
      type: 'query',
      requestId: 'q',
      queryId: 'popular-q',
      generation: 1,
      accountKey: fixture.initial.items[0]!.account.key,
      filter: {},
      sort: [{ by: 'id', direction: 'asc' }],
      search: '',
    });
    const preview = await fixture.api({
      type: 'previewBulk',
      requestId: 'p',
      pageId: 'person',
      previewId: 'popular-p',
      queryId: 'popular-q',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
      skipPopular: true,
    });
    expect(preview.status).toBe(200);
    expect(preview.replies).toMatchObject([
      { type: 'bulkPreview', total: 20, willChange: 18, skippedPopular: 2 },
    ]);
    const applied = await fixture.api({
      type: 'confirmBulk',
      requestId: 'c',
      commandId: 'popular-c',
      pageId: 'person',
      previewId: 'popular-p',
    });
    expect(applied.replies).toMatchObject([{ type: 'committed', changed: 18 }]);
    for (const id of ['x:119', 'x:120']) {
      const detail = await fixture.api({
        type: 'detail',
        requestId: `detail-${id}`,
        itemId: id,
      });
      expect(detail.replies).toMatchObject([
        { type: 'itemDetail', events: [] },
      ]);
    }
    const changed = await fixture.api({
      type: 'detail',
      requestId: 'changed',
      itemId: 'x:101',
    });
    expect(changed.replies).toMatchObject([
      {
        type: 'itemDetail',
        events: [
          { value: 'delete', source: { kind: 'human', via: 'local-review' } },
        ],
      },
    ]);
  } finally {
    await fixture.dispose();
  }
});
