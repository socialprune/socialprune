import { expect, test, vi } from 'vitest';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';
import { CommandQueue } from '../../workspace/command-queue.ts';
import { FeedSession } from './session.ts';
import type { WorkspaceClient } from '../../workspace/client.ts';
const cards = Array.from({ length: 100 }, (_, n) => ({
  item: { ...contractWorkspace().items[0]!, id: `x:${n}` },
  decision: 'undecided' as const,
  suggestions: [],
  holdingRules: [],
  outcome: 'unknown' as const,
  decisionEvent: null,
  plan: null,
}));
function fixture() {
  const requests: unknown[] = [];
  let release!: (reply: unknown) => void;
  const values = new Map<string, 'keep' | 'delete'>();
  const port = {
    commands: new CommandQueue(),
    request: vi.fn((input: unknown) => {
      requests.push(input);
      return new Promise((resolve) => {
        release = (reply) => {
          const value = input as {
            type: string;
            itemIds: string[];
            value: 'keep' | 'delete';
          };
          if (
            value.type === 'decide' &&
            (reply as { changed: number }).changed === 1
          )
            values.set(value.itemIds[0]!, value.value);
          resolve(reply);
        };
      });
    }),
    planCounts: vi.fn(() =>
      Promise.resolve({
        type: 'planCounts',
        tabs: { all: 100, suggested: 100 },
        unchecked: {},
        popularThreshold: null,
      }),
    ),
    feedWindow: vi.fn(
      (input: { offset?: number; anchor?: string; limit: number }) => {
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
    release: (reply: unknown) => release(reply),
    session: new FeedSession(port as unknown as WorkspaceClient),
  };
}
const saved = { type: 'committed', changed: 1 };
test('FAST-1 card state and next card change before confirmation, serialized in click order', async () => {
  const f = fixture();
  await f.session.open('x:contract', 'suggested');
  const first = f.session.decide('x:0', 'keep');
  const second = f.session.decide('x:1', 'delete');
  expect(f.session.snapshot.cards[0]?.item.id).toBe('x:2');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.release(saved);
  await first;
  await vi.waitFor(() => expect(f.requests).toHaveLength(2));
  f.release(saved);
  await second;
  expect(f.requests).toMatchObject([{ value: 'keep' }, { value: 'delete' }]);
});
test('FAST-1 failed/not-saved decision restores prior state and recovery focus', async () => {
  const f = fixture();
  await f.session.open('x:contract', 'suggested');
  const pending = f.session.decide('x:0', 'delete');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.release({ type: 'committed', changed: 0, skipped: 1 });
  expect(await pending).toBe(false);
  expect(f.session.snapshot.cards[0]?.decision).toBe('undecided');
  expect(f.session.snapshot.saveFailure?.itemId).toBe('x:0');
});
test('FAST-1 undo waits behind pending decision and preview waits behind undo', async () => {
  const f = fixture();
  await f.session.open('x:contract', 'all');
  const decision = f.session.decide('x:0', 'keep');
  const undo = f.session.undo();
  const preview = f.session.preview();
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  expect(f.port.previewPlan).not.toHaveBeenCalled();
  f.release(saved);
  await decision;
  await vi.waitFor(() => expect(f.requests).toHaveLength(2));
  expect(f.requests[1]).toMatchObject({ type: 'undo' });
  expect(f.port.previewPlan).not.toHaveBeenCalled();
  f.release(saved);
  await undo;
  await preview;
  expect(f.port.previewPlan).toHaveBeenCalledOnce();
});
test('FAST-1 repeated pending changes to one card cannot retain an unsaved state after failure', async () => {
  const f = fixture();
  await f.session.open('x:contract', 'all');
  const first = f.session.decide('x:0', 'keep');
  const second = f.session.decide('x:0', 'delete');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.release({ type: 'failed', code: 'STORAGE_FAILED' });
  expect(await first).toBe(false);
  expect(await second).toBe(false);
  expect(f.requests).toHaveLength(1);
  expect(f.session.snapshot.cards[0]?.decision).toBe('undecided');
});
test('FAST-1 redo uses the same serialized queue and retains sort while reopening', async () => {
  const f = fixture();
  await f.session.open('x:contract', 'all', undefined, 'likes');
  const redo = f.session.undo(undefined, 'redo');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.release(saved);
  await redo;
  expect(f.requests[0]).toMatchObject({ type: 'redo' });
  expect(f.session.snapshot.sort).toBe('likes');
});
test('FAST-1 prefetch makes the next service window resident without raising the 300-card bound', async () => {
  const f = fixture();
  await f.session.open('x:contract', 'all');
  await vi.waitFor(() =>
    expect(f.session.snapshot.cards.length).toBeGreaterThan(50),
  );
  expect(f.session.snapshot.cards[50]?.item.id).toBe('x:50');
  expect(f.session.snapshot.cards.length).toBeLessThanOrEqual(300);
  expect(
    f.port.feedWindow.mock.calls.every(([input]) => input.limit <= 50),
  ).toBe(true);
});
