import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import { readWorkspace } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { ReviewService } from './review.ts';
import type { ReviewQuery } from './query.ts';

function setup() {
  const initial = contractWorkspace();
  initial.items.push({
    ...initial.items[0]!,
    id: 'x:2',
    text: 'Generated second item.',
  });
  initial.counts.items = 2;
  const backing = new MemoryStoreBacking(initial);
  const store = createMemoryStore(backing);
  let time = new Date('2026-02-01T00:00:00.000Z');
  let sequence = 0;
  let ids = ['x:1', 'x:2'];
  const query: ReviewQuery = {
    async selection() {
      return {
        ids: [...ids],
        revision: (await store.read(async (tx) => tx.runtime.get())).revision,
      };
    },
  };
  const options = {
    query,
    via: 'web-review' as const,
    now: () => time,
    uuid: () => `generated-${++sequence}`,
  };
  return {
    backing,
    store,
    service: new ReviewService(store, options),
    options,
    setTime(value: string) {
      time = new Date(value);
    },
    setIds(value: string[]) {
      ids = value;
    },
  };
}
test('human commands are atomic, expected guarded and idempotent including after reopening', async () => {
  const { backing, store, service, options } = setup();
  try {
    const command = {
      commandId: 'c1',
      itemIds: ['x:1'],
      value: 'delete' as const,
      expected: { 'x:1': 'undecided' as const },
    };
    const first = await service.decide(command);
    expect(first).toMatchObject({ type: 'committed', changed: 1, revision: 1 });
    expect(await service.decide(command)).toEqual(first);
    expect(await service.decide({ ...command, value: 'keep' })).toMatchObject({
      code: 'EVENT_CONFLICT',
    });
    expect(
      await service.decide({ ...command, commandId: 'stale', value: 'keep' }),
    ).toMatchObject({ code: 'STALE' });
    expect(
      await service.decide({
        commandId: 'unknown',
        itemIds: ['x:1', 'x:missing'],
        value: 'keep',
        expected: { 'x:1': 'delete', 'x:missing': 'undecided' },
      }),
    ).toMatchObject({ code: 'UNKNOWN_ITEM' });
    const log = await store.read(readWorkspace);
    expect(log.decisionEvents).toHaveLength(1);
    expect(log.decisionEvents[0]).toMatchObject({
      previous: 'undecided',
      value: 'delete',
      source: { kind: 'human', via: 'web-review' },
    });
    await store.close();
    const reopened = createMemoryStore(backing);
    try {
      expect(
        await new ReviewService(reopened, options).decide(command),
      ).toEqual(first);
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
  }
});
test('store rejection rolls back events, state and revision and the command reports STORAGE', async () => {
  const { store, options } = setup();
  const failing: WorkspaceStore = {
    read: (operation) => store.read(operation),
    close: () => store.close(),
    write: (operation) =>
      store.write(async (tx) => {
        const result = await operation(tx);
        throw new Error(`Synthetic lost commit ${JSON.stringify(result)}`);
      }),
  };
  try {
    const before = await store.read(readWorkspace);
    expect(
      await new ReviewService(failing, options).decide({
        commandId: 'fail',
        itemIds: ['x:1'],
        value: 'delete',
        expected: { 'x:1': 'undecided' },
      }),
    ).toEqual({ type: 'rejected', commandId: 'fail', code: 'STORAGE' });
    expect(await store.read(readWorkspace)).toEqual(before);
    expect(await store.read(async (tx) => tx.runtime.get())).toEqual({
      revision: 0,
      lastEventSeq: 0,
    });
    expect(await store.read(async (tx) => tx.state.get('x:1'))).toMatchObject({
      decision: 'undecided',
    });
  } finally {
    await store.close();
  }
});
test('preview freezes exact IDs and overwrite values, never a later query result', async () => {
  const context = setup();
  const { service, store } = context;
  try {
    await service.decide({
      commandId: 'keep',
      itemIds: ['x:2'],
      value: 'keep',
      expected: { 'x:2': 'undecided' },
    });
    const overwrite: ('undecided' | 'later' | 'keep')[] = [
      'undecided',
      'later',
    ];
    const preview = await service.previewBulk({
      pageId: 'page',
      previewId: 'p',
      queryId: 'q',
      generation: 1,
      value: 'delete',
      overwrite,
    });
    overwrite.push('keep');
    expect(preview).toMatchObject({
      total: 2,
      willChange: 1,
      unchanged: 1,
      byCurrentValue: { keep: 1, delete: 0, later: 0, undecided: 1 },
    });
    context.setIds(['x:2']);
    const result = await service.confirmBulk({
      commandId: 'bulk',
      pageId: 'page',
      previewId: 'p',
    });
    expect(result).toMatchObject({ type: 'committed', changed: 1 });
    expect(
      (await store.read(async (tx) => tx.state.get('x:1')))?.decision,
    ).toBe('delete');
    expect(
      (await store.read(async (tx) => tx.state.get('x:2')))?.decision,
    ).toBe('keep');
    expect(
      await service.confirmBulk({
        commandId: 'bulk',
        pageId: 'page',
        previewId: 'p',
      }),
    ).toEqual(result);
    expect(
      await service.confirmBulk({
        commandId: 'again',
        pageId: 'page',
        previewId: 'p',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
  } finally {
    await store.close();
  }
});
test('wrong-page confirmation cannot consume another page preview and undo skips intervening state', async () => {
  const { service, store } = setup();
  try {
    await service.previewBulk({
      pageId: 'owner',
      previewId: 'p',
      queryId: 'q',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
    });
    expect(
      await service.confirmBulk({
        commandId: 'wrong-page',
        pageId: 'foreign',
        previewId: 'p',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
    expect(
      await service.confirmBulk({
        commandId: 'right-page',
        pageId: 'owner',
        previewId: 'p',
      }),
    ).toMatchObject({ changed: 2 });
    // Inject an intervening state in this test only to exercise the mismatch
    // branch without manufacturing a newer undoable command.
    await store.write(async (tx) => {
      await tx.state.put({
        itemId: 'x:2',
        decision: 'keep',
        outcome: 'unknown',
      });
    });
    expect(await service.undo('skip-stale')).toMatchObject({
      changed: 1,
      skipped: 1,
    });
    expect(
      (await store.read(async (tx) => tx.state.get('x:1')))?.decision,
    ).toBe('undecided');
    expect(
      (await store.read(async (tx) => tx.state.get('x:2')))?.decision,
    ).toBe('keep');
  } finally {
    await store.close();
  }
});
test('stale previews reject all IDs; expiry, page replacement, release and fifth-page eviction reject', async () => {
  const context = setup(),
    { service, store } = context;
  const preview = (pageId: string, previewId: string) =>
    service.previewBulk({
      pageId,
      previewId,
      queryId: 'q',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
    });
  try {
    await preview('stale-page', 'stale-preview');
    await service.decide({
      commandId: 'changed',
      itemIds: ['x:1'],
      value: 'later',
      expected: { 'x:1': 'undecided' },
    });
    expect(
      await service.confirmBulk({
        commandId: 'stale-confirm',
        pageId: 'stale-page',
        previewId: 'stale-preview',
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW', changedSince: 1 });
    expect(
      (await store.read(async (tx) => tx.state.get('x:2')))?.decision,
    ).toBe('undecided');
    await preview('expiry-page', 'expiry');
    context.setTime('2026-02-01T00:10:00.000Z');
    expect(
      await service.confirmBulk({
        commandId: 'expired-confirm',
        pageId: 'expiry-page',
        previewId: 'expiry',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
    await preview('one-page', 'old');
    await preview('one-page', 'replacement');
    expect(
      await service.confirmBulk({
        commandId: 'replaced-confirm',
        pageId: 'one-page',
        previewId: 'old',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
    service.releasePreview('wrong-page', 'replacement');
    service.releasePreview('one-page', 'replacement');
    expect(
      await service.confirmBulk({
        commandId: 'released-confirm',
        pageId: 'one-page',
        previewId: 'replacement',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
    for (let index = 0; index < 5; index++)
      await preview(`page-${index}`, `preview-${index}`);
    expect(
      await service.confirmBulk({
        commandId: 'evicted-confirm',
        pageId: 'page-0',
        previewId: 'preview-0',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
    service.closeSession();
    expect(
      await service.confirmBulk({
        commandId: 'closed-confirm',
        pageId: 'page-4',
        previewId: 'preview-4',
      }),
    ).toMatchObject({ code: 'PREVIEW_EXPIRED' });
  } finally {
    await store.close();
  }
});
test('undo and redo append, history survives reopen and a new action discards redo', async () => {
  const { backing, store, service, options } = setup();
  try {
    await service.decide({
      commandId: 'd1',
      itemIds: ['x:1', 'x:2'],
      value: 'delete',
      expected: { 'x:1': 'undecided', 'x:2': 'undecided' },
    });
    expect(await service.undo('undo-1')).toMatchObject({
      changed: 2,
      skipped: 0,
    });
    const log = await store.read(readWorkspace);
    expect(
      log.decisionEvents.map((event) => [
        event.previous,
        event.value,
        event.action.kind,
      ]),
    ).toEqual([
      ['undecided', 'delete', 'bulk'],
      ['undecided', 'delete', 'bulk'],
      ['delete', 'undecided', 'undo'],
      ['delete', 'undecided', 'undo'],
    ]);
    await store.close();
    const reopened = createMemoryStore(backing);
    try {
      const reloaded = new ReviewService(reopened, options);
      expect((await reloaded.history()).map((entry) => entry.kind)).toEqual([
        'undo',
        'bulk',
      ]);
      expect(await reloaded.redo('redo-1')).toMatchObject({ changed: 2 });
      expect((await reopened.read(readWorkspace)).decisionEvents).toHaveLength(
        6,
      );
      expect(await reloaded.undo('undo-2')).toMatchObject({ changed: 2 });
      await reloaded.decide({
        commandId: 'new',
        itemIds: ['x:1'],
        value: 'keep',
        expected: { 'x:1': 'undecided' },
      });
      expect(await reloaded.redo('redo-branch')).toMatchObject({
        code: 'NOTHING_TO_REDO',
      });
      expect(
        await reloaded.outcome({
          commandId: 'outcome',
          itemIds: ['x:1'],
          value: 'deleted-by-user',
          expected: { 'x:1': 'unknown' },
        }),
      ).toMatchObject({ changed: 1 });
      expect(await reloaded.undo('undo-outcome')).toMatchObject({ changed: 1 });
      expect(
        (await reopened.read(async (tx) => tx.state.get('x:1')))?.outcome,
      ).toBe('unknown');
      expect((await reopened.read(readWorkspace)).outcomeEvents).toHaveLength(
        2,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
  }
});
