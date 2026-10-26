import { expect, test, vi } from 'vitest';
import type {
  DesktopBridge,
  DesktopReply,
  RunView,
} from '@socialprune/core/workspace/desktop-protocol';
import { DesktopReplySchema } from '@socialprune/core/workspace/desktop-protocol';
import { HttpReviewRequestSchema } from '@socialprune/core/workspace/protocol';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import { QueryEngine } from '@socialprune/core/workspace/query';
import { ReviewService } from '@socialprune/core/workspace/review';
import { WorkspaceClient } from '../workspace/client.ts';
import { BridgeWorkspacePort } from './bridge-port.ts';
import { subscribeRunView } from './bridge.ts';

function fixture(reply: (requestId: string) => unknown) {
  const send = vi.fn<DesktopBridge['request']>((input) =>
    Promise.resolve(reply(input.requestId) as DesktopReply),
  );
  const bridge: DesktopBridge = {
    request: send,
    onRunView: () => () => undefined,
  };
  const port = new BridgeWorkspacePort(bridge);
  return { port, client: new WorkspaceClient(port), send, bridge };
}

test('plan preview and confirmation share the bridge page even after a component remount', async () => {
  const store = createMemoryStore();
  const review = new ReviewService(store, {
    query: new QueryEngine(store),
    via: 'local-review',
  });
  const { client, send } = fixture(() => null);
  send.mockImplementation(async (raw) => {
    const input = HttpReviewRequestSchema.parse(raw);
    if (input.type === 'previewPlan')
      return {
        type: 'reviewReply',
        requestId: input.requestId,
        replies: [
          {
            type: 'bulkPreview',
            requestId: input.requestId,
            ...(await review.previewPlan(input)),
          },
        ],
      };
    if (input.type === 'confirmBulk')
      return {
        type: 'reviewReply',
        requestId: input.requestId,
        replies: [
          { requestId: input.requestId, ...(await review.confirmBulk(input)) },
        ],
      };
    throw new Error('Unexpected generated request.');
  });
  try {
    const preview = await client.previewPlan({
      accountKey: 'x:generated',
      previewId: 'plan',
      pageId: 'first-component',
    });
    expect(preview.type).toBe('bulkPreview');
    if (preview.type !== 'bulkPreview') throw new Error('Preview required.');
    expect(preview.pageId).not.toBe('first-component');
    expect(preview.plan?.accountKey).toBe('x:generated');
    expect(
      await client.request({
        type: 'confirmBulk',
        requestId: 'confirm-plan',
        commandId: 'confirm-plan',
        previewId: 'plan',
        pageId: 'remounted-component',
      }),
    ).toMatchObject({ type: 'committed', changed: 0 });
    expect(
      send.mock.calls.map(([input]) =>
        'pageId' in input ? input.pageId : null,
      ),
    ).toEqual([preview.pageId, preview.pageId]);
  } finally {
    client.dispose();
    await store.close();
  }
});

test('all non-preview feed requests forward unchanged through the bridge', async () => {
  const { client, send } = fixture((requestId) => ({
    type: 'reviewReply',
    requestId,
    replies: [{ type: 'done', requestId }],
  }));
  const requests = [
    { type: 'planCounts', requestId: 'counts', accountKey: 'x:generated' },
    {
      type: 'feedWindow',
      requestId: 'window',
      accountKey: 'x:generated',
      tab: 'all',
      sort: 'reposts',
      offset: 0,
      limit: 50,
    },
    {
      type: 'setCriteria',
      requestId: 'criteria',
      criteria: {
        selected: ['political'],
        custom: [],
        nextCustom: 1,
        level: 1,
      },
      removeCategories: ['earlier-generated'],
    },
    { type: 'setKeepRules', requestId: 'rules', keepRules: [] },
  ] as const;
  try {
    for (const input of requests)
      await client.request(HttpReviewRequestSchema.parse(input));
    expect(send.mock.calls.map(([input]) => input)).toEqual(requests);
    expect(client.diagnostics).toEqual([]);
  } finally {
    client.dispose();
  }
});

test('existing client receives progress and chunks before a validated terminal reply', async () => {
  const chunks = ['generated,', 'entry\n'];
  const { port, client } = fixture((requestId) => ({
    type: 'reviewReply',
    requestId,
    replies: [
      { type: 'progress', requestId, completed: 0, total: 1 },
      ...chunks.map((chunk, index) => ({
        type: 'clickListExportChunk',
        requestId,
        listId: 'generated',
        format: 'csv',
        revision: 1,
        index,
        chunk,
      })),
      {
        type: 'clickListExported',
        requestId,
        listId: 'generated',
        format: 'csv',
        revision: 1,
        entries: 1,
        bytes: new TextEncoder().encode(chunks.join('')).length,
      },
    ],
  }));
  const received: string[] = [];
  await client.exportClickList('generated', 'csv', (chunk) => {
    received.push(chunk);
    return Promise.resolve();
  });
  expect(received).toEqual(chunks);
  client.dispose();
  port.terminate();
});

test.each([
  'wrong-id',
  'terminal-first',
  'missing-terminal',
  'wrong-method',
  'malformed',
])('rejects %s without accepting partial replies', async (shape) => {
  const { client, port } = fixture((requestId) => {
    const released = { type: 'released', requestId };
    if (shape === 'wrong-id')
      return { type: 'reviewReply', requestId: 'foreign', replies: [released] };
    if (shape === 'terminal-first')
      return {
        type: 'reviewReply',
        requestId,
        replies: [
          released,
          { type: 'progress', requestId, completed: 1, total: 1 },
        ],
      };
    if (shape === 'missing-terminal')
      return { type: 'reviewReply', requestId, replies: [] };
    if (shape === 'wrong-method') return { type: 'linkOpened', requestId };
    return {
      type: 'reviewReply',
      requestId,
      replies: [{ type: 'unknown', requestId }],
    };
  });
  await expect(
    client.request({
      type: 'releasePreview',
      requestId: 'request',
      pageId: 'page',
      previewId: 'preview',
    }),
  ).rejects.toThrow();
  client.dispose();
  port.terminate();
});

test('browser-only requests and transferables never reach the bridge', () => {
  const { port, send } = fixture(() => null);
  const messages: unknown[] = [];
  port.addEventListener('message', (event) => messages.push(event.data));
  port.postMessage({
    type: 'deleteWorkspace',
    requestId: 'forbidden',
    workspaceId: 'active',
  });
  port.postMessage({ type: 'revision', requestId: 'transfer' }, [
    new ArrayBuffer(1),
  ]);
  expect(send).not.toHaveBeenCalled();
  expect(messages).toEqual([
    { type: 'failed', requestId: 'forbidden', code: 'INVALID_REQUEST' },
    { type: 'failed', requestId: 'transfer', code: 'INVALID_REQUEST' },
  ]);
  port.terminate();
});

test('run pushes are schema checked and unsubscribed', () => {
  const listener = vi.fn(),
    invalid = vi.fn(),
    unsubscribe = vi.fn();
  let push: ((view: unknown) => void) | undefined;
  const bridge: DesktopBridge = {
    request: () => Promise.reject(new Error('unused')),
    onRunView(callback) {
      push = (view) => callback(view as RunView);
      return unsubscribe;
    },
  };
  const stop = subscribeRunView(bridge, listener, invalid);
  push!({ phase: 'idle', version: 1 });
  push!({ phase: 'running', version: 2 });
  expect(listener).toHaveBeenCalledExactlyOnceWith({
    phase: 'idle',
    version: 1,
  });
  expect(invalid).toHaveBeenCalledOnce();
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('the protocol itself rejects a planted mixed-identity reply', () => {
  expect(() =>
    DesktopReplySchema.parse({
      type: 'reviewReply',
      requestId: 'one',
      replies: [{ type: 'released', requestId: 'two' }],
    }),
  ).toThrow();
});
