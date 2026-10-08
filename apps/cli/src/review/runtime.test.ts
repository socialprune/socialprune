import { expect, test } from 'vitest';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import type { HttpReviewRequest } from '@socialprune/core/workspace/protocol';
import { browserWorkspace } from '../workspace/test/inputs.ts';
import { ReviewRuntime } from './runtime.ts';

test('previews replace per page, bind page identity, evict fifth, release and expire at ten minutes', async () => {
  let now = Date.parse('2026-10-08T00:00:00Z');
  const initial = browserWorkspace();
  initial.decisionEvents = [];
  initial.outcomeEvents = [];
  initial.counts.decisionEvents = 0;
  initial.counts.outcomeEvents = 0;
  const runtime = new ReviewRuntime(
    createMemoryStore(new MemoryStoreBacking(initial)),
    { now: () => new Date(now) },
  );
  let id = 0;
  const run = (input: HttpReviewRequest) => runtime.run(++id, input);
  const preview = (pageId: string, previewId: string) =>
    run({
      type: 'previewBulk',
      requestId: previewId,
      queryId: 'view',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided', 'later'],
      pageId,
      previewId,
    });
  const confirm = (pageId: string, previewId: string) =>
    run({
      type: 'confirmBulk',
      requestId: `confirm-${id}`,
      commandId: `confirm-${id}`,
      pageId,
      previewId,
    });
  try {
    await run({
      type: 'query',
      requestId: 'q',
      queryId: 'view',
      generation: 1,
      accountKey: 'x:generated',
      filter: {},
      sort: [{ by: 'id', direction: 'asc' }],
      search: '',
    });
    expect(await preview('a', 'a1')).toMatchObject([
      { type: 'bulkPreview', total: 2, willChange: 2 },
    ]);
    await preview('a', 'a2');
    expect(await confirm('a', 'a1')).toMatchObject([
      { type: 'rejected', code: 'PREVIEW_EXPIRED' },
    ]);
    expect(await confirm('foreign', 'a2')).toMatchObject([
      { type: 'rejected', code: 'PREVIEW_EXPIRED' },
    ]);
    for (const page of ['b', 'c', 'd', 'e']) await preview(page, page);
    expect(await confirm('a', 'a2')).toMatchObject([
      { type: 'rejected', code: 'PREVIEW_EXPIRED' },
    ]);
    await run({
      type: 'releasePreview',
      requestId: 'release',
      pageId: 'b',
      previewId: 'b',
    });
    expect(await confirm('b', 'b')).toMatchObject([
      { type: 'rejected', code: 'PREVIEW_EXPIRED' },
    ]);
    now += 10 * 60000;
    expect(await confirm('c', 'c')).toMatchObject([
      { type: 'rejected', code: 'PREVIEW_EXPIRED' },
    ]);
    await run({
      type: 'query',
      requestId: 'q2',
      queryId: 'fresh-view',
      generation: 1,
      accountKey: 'x:generated',
      filter: {},
      sort: [{ by: 'id', direction: 'asc' }],
      search: '',
    });
    await run({
      type: 'previewBulk',
      requestId: 'fresh',
      queryId: 'fresh-view',
      generation: 1,
      pageId: 'fresh',
      previewId: 'fresh',
      value: 'delete',
      overwrite: ['undecided', 'later'],
    });
    expect(await confirm('fresh', 'fresh')).toMatchObject([
      { type: 'committed', changed: 2 },
    ]);
  } finally {
    await runtime.close();
  }
});
