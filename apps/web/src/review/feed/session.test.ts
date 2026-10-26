import { expect, test, vi } from 'vitest';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';
import { FeedSession } from './session.ts';
import type { WorkspaceClient } from '../../workspace/client.ts';

const counts = {
  tabs: { suggested: 400, held: 1, kept: 0, unclear: 1, marked: 0, all: 402 },
  hits: {},
  held: {},
  unchecked: {},
  popularThreshold: 3,
};
const card = (n: number) => ({
  item: { ...contractWorkspace().items[0]!, id: `x:${n}` },
  suggestions: [],
  holdingRules: [],
  decision: 'undecided' as const,
  outcome: 'unknown' as const,
  decisionEvent: null,
  plan: null,
});
function client() {
  return {
    planCounts: vi.fn(() =>
      Promise.resolve({
        type: 'planCounts',
        requestId: 'counts',
        ...counts,
      }),
    ),
    feedWindow: vi.fn(
      (input: { offset?: number; limit: number; anchor?: string }) =>
        Promise.resolve({
          type: 'feedCards',
          requestId: 'cards',
          total: 400,
          anchorIndex: input.anchor ? 7 : null,
          cards: Array.from({ length: input.limit }, (_, n) =>
            card((input.offset ?? (input.anchor ? 7 : 0)) + n),
          ),
        }),
    ),
    request: vi.fn((_input: unknown) =>
      Promise.resolve({
        type: 'committed',
        requestId: 'decision',
        commandId: 'command',
        actionId: 'action',
        revision: 1,
        changed: 1,
      }),
    ),
    previewPlan: vi.fn(),
  };
}
test('window requests stay within 50 and retained card data within 300 after paging', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'all');
  for (let n = 50; n < 400; n += 50) await session.load(n);
  expect(session.snapshot.cards.length).toBeLessThanOrEqual(300);
  expect(port.feedWindow.mock.calls.every(([input]) => input.limit <= 50)).toBe(
    true,
  );
  expect(port.planCounts).toHaveBeenCalledWith('x:contract');
});
test('SORT-1 uses the selected server sort through paging, undo and guarded decision readback', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'all', undefined, 'likes');
  await session.load(50);
  await session.undo();
  await session.decide('x:0', 'keep');
  expect(
    port.feedWindow.mock.calls.every(
      ([input]) => 'sort' in input && input.sort === 'likes',
    ),
  ).toBe(true);
});
test('late cards from another account never replace the current account window', async () => {
  const port = client();
  let release!: (reply: unknown) => void;
  port.feedWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve as typeof release;
      }),
  );
  const session = new FeedSession(port as unknown as WorkspaceClient);
  const old = session.open('x:old', 'all');
  await vi.waitFor(() => expect(release).toBeDefined());
  await session.open('x:new', 'all');
  release({
    type: 'feedCards',
    total: 1,
    anchorIndex: null,
    cards: [card(999)],
  });
  await old;
  expect(session.snapshot.accountKey).toBe('x:new');
  expect(
    session.snapshot.cards.some((entry) => entry.item.id === 'x:999'),
  ).toBe(false);
});
test('decide uses a single guarded command, refreshes counts and keeps the decided card in place', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'suggested');
  const id = session.snapshot.cards[0]!.item.id;
  port.feedWindow.mockResolvedValueOnce({
    type: 'feedCards',
    requestId: 'readback',
    total: 400,
    anchorIndex: 0,
    cards: [{ ...card(0), decision: 'keep' }],
  } as unknown as Awaited<ReturnType<typeof port.feedWindow>>);
  await session.decide(id, 'keep');
  expect(port.request.mock.calls[0]?.[0]).toMatchObject({
    type: 'decide',
    itemIds: [id],
    value: 'keep',
    expected: { [id]: 'undecided' },
  });
  expect(session.snapshot.cards[0]?.decision).toBe('keep');
  expect(port.planCounts).toHaveBeenCalledTimes(2);
});
test('stale confirmation gets a replacement preview and never confirms it automatically', async () => {
  const port = client();
  const preview = {
    type: 'bulkPreview',
    requestId: 'preview',
    previewId: 'initial',
    willChange: 2,
  };
  port.previewPlan
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce({ ...preview, previewId: 'replacement' });
  port.request.mockResolvedValueOnce({
    type: 'rejected',
    requestId: 'confirm',
    commandId: 'cmd',
    code: 'STALE_PREVIEW',
  } as unknown as Awaited<ReturnType<typeof port.request>>);
  const session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'suggested');
  await session.preview();
  const result = await session.confirm();
  expect(result).toBe('changed');
  expect(port.request).toHaveBeenCalledTimes(1);
  expect(session.snapshot.preview?.previewId).toBe('replacement');
  expect(session.snapshot.previewState).toBe('changed');
});
test('anchor loading uses the service anchor index rather than a local membership filter', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'held', 'x:7');
  expect(port.feedWindow).toHaveBeenCalledWith(
    expect.objectContaining({ anchor: 'x:7', tab: 'held' }),
  );
  expect(session.snapshot.start).toBe(7);
});
test('undo uses one real command and reopens the service tab and anchor with restored decisions', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'suggested');
  await session.undo('x:7');
  expect(port.request).toHaveBeenCalledTimes(1);
  expect(port.request).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'undo' }),
  );
  expect(port.feedWindow).toHaveBeenLastCalledWith(
    expect.objectContaining({
      accountKey: 'x:contract',
      tab: 'suggested',
      anchor: 'x:7',
    }),
  );
  expect(session.snapshot.cards[0]?.decision).toBe('undecided');
  expect(session.snapshot.busy).toBe(false);
  expect(port.planCounts).toHaveBeenCalledTimes(2);
});
test('canceling a pending preview releases its late response and never reopens it', async () => {
  const port = client();
  let release!: (value: unknown) => void;
  port.previewPlan.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'suggested');
  const pending = session.preview();
  session.cancelPreview();
  release({ type: 'bulkPreview', previewId: 'late', willChange: 1 });
  await pending;
  expect(session.snapshot.preview).toBeNull();
  expect(port.request).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'releasePreview' }),
  );
});
test('switching tabs during decision count readback clears busy and ignores the old decision result', async () => {
  const port = client();
  const session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'suggested');
  port.feedWindow.mockResolvedValueOnce({
    type: 'feedCards',
    requestId: 'readback',
    total: 400,
    anchorIndex: 0,
    cards: [{ ...card(0), decision: 'keep' }],
  } as unknown as Awaited<ReturnType<typeof port.feedWindow>>);
  let release!: (reply: Awaited<ReturnType<typeof port.planCounts>>) => void;
  port.planCounts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const decision = session.decide('x:0', 'keep');
  await vi.waitFor(() => expect(release).toBeDefined());
  await session.open('x:contract', 'all');
  expect(session.snapshot.busy).toBe(false);
  release({ type: 'planCounts', requestId: 'late-counts', ...counts });
  expect(await decision).toBe(false);
  expect(session.snapshot.tab).toBe('all');
  expect(session.snapshot.cards[0]?.decision).toBe('undecided');
});

test('an explicit first-card navigation supersedes a pending scroll window instead of being dropped', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'suggested');
  await session.load(350);
  let release!: (value: Awaited<ReturnType<typeof port.feedWindow>>) => void;
  port.feedWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const scrollRead = session.load(300);
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(await session.seek(0)).toBe('x:0');
  expect(session.snapshot.cards[0]?.item.id).toBe('x:0');
  release({
    type: 'feedCards',
    requestId: 'late-scroll',
    total: 400,
    anchorIndex: null,
    cards: Array.from({ length: 50 }, (_, n) => card(300 + n)),
  });
  await scrollRead;
  expect(session.snapshot.start).toBe(0);
});

test('a navigation read from a previous account cannot focus a same-ID card in the next account', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:old', 'all');
  let release!: (value: Awaited<ReturnType<typeof port.feedWindow>>) => void;
  port.feedWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const navigation = session.seek(350);
  await vi.waitFor(() => expect(release).toBeDefined());
  await session.open('x:new', 'all');
  release({
    type: 'feedCards',
    requestId: 'old-navigation',
    total: 400,
    anchorIndex: null,
    cards: [card(350)],
  });
  expect(await navigation).toBeNull();
  expect(session.snapshot.accountKey).toBe('x:new');
  expect(session.snapshot.cards[0]?.item.id).toBe('x:0');
});

test('late explicit navigation cannot overwrite the newer first window or its loading state', async () => {
  const port = client(),
    session = new FeedSession(port as unknown as WorkspaceClient);
  await session.open('x:contract', 'all');
  let release!: (value: Awaited<ReturnType<typeof port.feedWindow>>) => void;
  port.feedWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const end = session.seek(399);
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(await session.seek(0)).toBe('x:0');
  release({
    type: 'feedCards',
    requestId: 'late-end',
    total: 400,
    anchorIndex: null,
    cards: Array.from({ length: 50 }, (_, n) => card(350 + n)),
  });
  expect(await end).toBeNull();
  expect(session.snapshot.start).toBe(0);
  expect(session.snapshot.loading).toBe(false);
  expect(session.snapshot.cards[0]?.item.id).toBe('x:0');
});
