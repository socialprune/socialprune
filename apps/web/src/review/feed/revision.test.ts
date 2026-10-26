import { expect, test, vi } from 'vitest';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';
import { CommandQueue } from '../../workspace/command-queue.ts';
import { FeedSession } from './session.ts';
import type { WorkspaceClient } from '../../workspace/client.ts';
type Value = 'keep' | 'delete' | 'later' | 'undecided';
const cards = Array.from({ length: 100 }, (_, n) => ({
  item: { ...contractWorkspace().items[0]!, id: `x:${n}` },
  decision: 'undecided',
  suggestions: [],
  holdingRules: [],
  outcome: 'unknown' as const,
  decisionEvent: null,
  plan: null,
}));
function fixture(fail: (input: Record<string, unknown>, n: number) => boolean) {
  const requests: Record<string, unknown>[] = [],
    values = new Map<string, Value>(),
    history: { id: string; previous: Value }[] = [];
  let n = 0;
  const port = {
    commands: new CommandQueue(),
    request: vi.fn(async (input: Record<string, unknown>) => {
      requests.push(input);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const index = n++;
      if (input['type'] === 'decide') {
        const id = (input['itemIds'] as string[])[0]!,
          current = values.get(id) ?? 'undecided';
        if (fail(input, index)) return { type: 'failed', code: 'STORAGE' };
        if ((input['expected'] as Record<string, Value>)[id] !== current)
          return { type: 'committed', changed: 0, skipped: 1 };
        values.set(id, input['value'] as Value);
        history.push({ id, previous: current });
        return { type: 'committed', changed: 1 };
      }
      if (input['type'] === 'undo' || input['type'] === 'redo') {
        const last = history.pop();
        if (last) values.set(last.id, last.previous);
        return { type: 'committed', changed: last ? 1 : 0 };
      }
      return { type: 'committed', changed: 0 };
    }),
    planCounts: vi.fn(() =>
      Promise.resolve({
        type: 'planCounts',
        tabs: {
          all: 100,
          suggested: 100,
          kept: 0,
          marked: 0,
          unclear: 0,
          held: 0,
        },
        unchecked: {},
        popularThreshold: null,
      }),
    ),
    feedWindow: vi.fn(
      (input: {
        offset?: number;
        anchor?: string;
        limit: number;
        tab?: string;
      }) => {
        const start = input.anchor
          ? Number(input.anchor.slice(2))
          : (input.offset ?? 0);
        return Promise.resolve({
          type: 'feedCards',
          cards: cards.slice(start, start + input.limit).map((card) => ({
            ...card,
            decision: values.get(card.item.id) ?? card.decision,
          })),
          total: 100,
          anchorIndex: input.anchor ? start : null,
        });
      },
    ),
    previewPlan: vi.fn(() => Promise.resolve({ type: 'bulkPreview' })),
    flushCommands: async () => {
      await port.commands.flush();
    },
  };
  return {
    port,
    requests,
    values,
    session: new FeedSession(port as unknown as WorkspaceClient),
  };
}
test('reviewer A: a failed second write leaves first and third human intents and their expected values intact', async () => {
  const f = fixture((input) => (input['itemIds'] as string[])[0] === 'x:1');
  await f.session.open('x:contract', 'all');
  expect(
    await Promise.all([
      f.session.decide('x:0', 'keep'),
      f.session.decide('x:1', 'delete'),
      f.session.decide('x:2', 'keep'),
    ]),
  ).toEqual([true, false, true]);
  expect([...f.values]).toEqual([
    ['x:0', 'keep'],
    ['x:2', 'keep'],
  ]);
  expect(
    f.requests.map((r) => [r['itemIds'], r['value'], r['expected']]),
  ).toEqual([
    [['x:0'], 'keep', { 'x:0': 'undecided' }],
    [['x:1'], 'delete', { 'x:1': 'undecided' }],
    [['x:2'], 'keep', { 'x:2': 'undecided' }],
  ]);
});
for (const kind of ['undo', 'redo'] as const)
  test(`F1 reviewer probe reversed: ${kind} behind a failed write sends nothing and retains the earlier delete`, async () => {
    const f = fixture(
      (input) => (input['itemIds'] as string[] | undefined)?.[0] === 'x:1',
    );
    await f.session.open('x:contract', 'all');
    expect(await f.session.decide('x:0', 'delete')).toBe(true);
    const failed = f.session.decide('x:1', 'keep'),
      reverse = f.session.undo(undefined, kind);
    expect(await failed).toBe(false);
    await reverse;
    expect(f.requests.filter((r) => r['type'] === kind)).toHaveLength(0);
    expect(f.values.get('x:0')).toBe('delete');
    expect(f.session.snapshot.saveFailure?.itemId).toBe('x:1');
    expect(f.session.snapshot.historyBlocked).toBe(kind);
  });
test('F2 reviewer probe reversed: disposal cannot erase the later failed write and client recovery record', async () => {
  const f = fixture(() => true);
  await f.session.open('x:contract', 'all');
  const write = f.session.decide('x:0', 'delete');
  f.session.dispose();
  expect(await write).toBe(false);
  expect(f.session.snapshot.saveFailure?.itemId).toBe('x:0');
  expect(f.port.commands.recovery?.itemId).toBe('x:0');
});
test('F3 reviewer probe reversed: fresh retry after a failure succeeds behind another pending item', async () => {
  const f = fixture((_input, n) => n === 0);
  await f.session.open('x:contract', 'all');
  expect(await f.session.decide('x:0', 'keep')).toBe(false);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.port.request.getMockImplementation()!;
  f.port.request.mockImplementation(async (input) => {
    if ((input['itemIds'] as string[] | undefined)?.[0] === 'x:5') await held;
    return original(input);
  });
  const slow = f.session.decide('x:5', 'keep'),
    retry = f.session.decide('x:0', 'keep');
  release();
  expect(await slow).toBe(true);
  expect(await retry).toBe(true);
  expect(f.values.get('x:0')).toBe('keep');
});
test('F4 reviewer probe reversed: stale prefetch after a jump cannot append old cards', async () => {
  const f = fixture(() => false),
    plain = f.port.feedWindow.getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = false;
  f.port.feedWindow.mockImplementation(async (input) => {
    if (input.anchor && input.limit === 50) {
      await held;
      finished = true;
    }
    return plain(input);
  });
  await f.session.open('x:contract', 'all');
  await f.session.seek(80);
  const before = f.session.snapshot.cards.map((c) => c.item.id);
  release();
  await vi.waitFor(() => expect(finished).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.session.snapshot.cards.map((c) => c.item.id)).toEqual(before);
  expect(
    f.session.snapshot.cards.every(
      (card, index) => card.item.id === `x:${f.session.snapshot.start + index}`,
    ),
  ).toBe(true);
});
test('F3 canceled dependent intents do not invalidate a fresh retry enqueued after the actual failure', async () => {
  const f = fixture((_input, n) => n === 0);
  await f.session.open('x:contract', 'all');
  const failed = f.session.decide('x:0', 'keep');
  const dependent = f.session.decide('x:0', 'delete');
  await failed;
  const retry = f.session.decide('x:0', 'keep');
  expect(await dependent).toBe(false);
  expect(await retry).toBe(true);
  expect(f.values.get('x:0')).toBe('keep');
});
test('F3 stale intent queued before a failure cannot replace a newer click or its readback', async () => {
  const f = fixture((_input, n) => n === 0);
  await f.session.open('x:contract', 'all');
  let releaseX!: () => void, releaseY!: () => void;
  const heldX = new Promise<void>((resolve) => {
    releaseX = resolve;
  });
  const heldY = new Promise<void>((resolve) => {
    releaseY = resolve;
  });
  const request = f.port.request.getMockImplementation()!;
  f.port.request.mockImplementation(async (input) => {
    const id = (input['itemIds'] as string[] | undefined)?.[0];
    if (id === 'x:0') await heldX;
    if (id === 'x:1') await heldY;
    return request(input);
  });
  const w1 = f.session.decide('x:0', 'keep');
  const other = f.session.decide('x:1', 'keep');
  const w2 = f.session.decide('x:0', 'later');
  releaseX();
  expect(await w1).toBe(false);
  const shown = () =>
    f.session.snapshot.cards.find((card) => card.item.id === 'x:0')?.decision;
  expect(shown()).toBe('undecided');
  const w3 = f.session.decide('x:0', 'delete');
  expect(shown()).toBe('delete');
  releaseY();
  expect([await other, await w2, await w3]).toEqual([true, false, true]);
  await f.port.commands.flush();
  expect(f.requests.filter((input) => input['value'] === 'later')).toHaveLength(
    0,
  );
  expect(f.values.get('x:0')).toBe('delete');
  expect(shown()).toBe('delete');
  expect(f.session.snapshot.saveFailure).toBeNull();
  expect(f.port.commands.recovery).toBeNull();
  expect(await f.session.decide('x:0', 'keep')).toBe(true);
  expect(f.values.get('x:0')).toBe('keep');
  expect(shown()).toBe('keep');
});
test('a membership readback resolving after a newer intent cannot overwrite that intent', async () => {
  const f = fixture(() => false);
  await f.session.open('x:contract', 'kept');
  const read = f.port.feedWindow.getMockImplementation()!;
  const request = f.port.request.getMockImplementation()!;
  let releaseWrite!: () => void;
  const heldWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  f.port.request.mockImplementation(async (input) => {
    if (input['value'] === 'delete') await heldWrite;
    return request(input);
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reading = false;
  f.port.feedWindow.mockImplementation(async (input) => {
    if (input.tab === 'kept' && input.limit === 1 && !reading) {
      reading = true;
      await held;
    }
    return read(input);
  });
  const first = f.session.decide('x:0', 'keep');
  await vi.waitFor(() => expect(reading).toBe(true));
  const next = f.session.decide('x:0', 'delete');
  expect(f.session.snapshot.cards.some((card) => card.item.id === 'x:0')).toBe(
    false,
  );
  release();
  expect(await first).toBe(true);
  // The next write is held so only the old membership response has settled.
  expect(f.session.snapshot.cards.some((card) => card.item.id === 'x:0')).toBe(
    false,
  );
  releaseWrite();
  expect(await next).toBe(true);
  expect(f.values.get('x:0')).toBe('delete');
});
test('a superseded write readback failure cannot hide the newer pending card', async () => {
  const f = fixture(() => false);
  await f.session.open('x:contract', 'all');
  const read = f.port.feedWindow.getMockImplementation()!;
  let reject!: () => void;
  const held = new Promise<void>((_resolve, rejectRead) => {
    reject = () => rejectRead(new Error('Readback failed'));
  });
  let reading = false;
  f.port.feedWindow.mockImplementation(async (input) => {
    if (input.limit === 1 && !reading) {
      reading = true;
      await held;
    }
    return read(input);
  });
  const first = f.session.decide('x:0', 'keep');
  await vi.waitFor(() => expect(reading).toBe(true));
  const next = f.session.decide('x:0', 'delete');
  reject();
  expect(await first).toBe(true);
  expect(await next).toBe(true);
  expect(f.session.snapshot.error).toBe(false);
  expect(f.session.snapshot.cards[0]?.decision).toBe('delete');
  expect(f.values.get('x:0')).toBe('delete');
});
test('F2 recovery reopens at a failed card outside the first service window', async () => {
  const f = fixture(() => true);
  await f.session.open('x:contract', 'all');
  await f.session.seek(80);
  expect(await f.session.decide('x:80', 'delete')).toBe(false);
  f.session.dispose();
  const reopened = new FeedSession(f.port as unknown as WorkspaceClient);
  await reopened.open('x:contract', 'all');
  expect(reopened.snapshot.cards[0]?.item.id).toBe('x:80');
  expect(reopened.snapshot.saveFailure?.itemId).toBe('x:80');
});
test('server readback overrides provisional client membership if the current tab disagrees', async () => {
  const f = fixture(() => false),
    read = f.port.feedWindow.getMockImplementation()!;
  f.port.feedWindow.mockImplementation((input) => {
    if (input.tab === 'kept' && input.limit === 1)
      return Promise.resolve({
        type: 'feedCards',
        cards: [],
        total: 0,
        anchorIndex: null,
      });
    return read(input);
  });
  await f.session.open('x:contract', 'kept');
  // The provisional predicate retains Keep in Kept, but the server disagrees.
  await f.session.decide('x:0', 'keep');
  expect(f.session.snapshot.cards.some((card) => card.item.id === 'x:0')).toBe(
    false,
  );
});
