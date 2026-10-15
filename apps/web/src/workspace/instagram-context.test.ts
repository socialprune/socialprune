import { readFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import {
  WorkspaceReplySchema,
  WorkspaceRequestSchema,
} from '@socialprune/core/workspace/protocol';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import type { WorkspaceRequest } from '@socialprune/core/workspace/protocol';

test('browser protocol accepts context reads but worker deliberately answers no display records', async () => {
  const record = instagramContractRecord(),
    input = {
      type: 'getInstagramContext',
      requestId: 'browser-context',
      itemIds: [record.itemId],
    };
  expect(WorkspaceRequestSchema.parse(input)).toEqual(input);
  expect(
    WorkspaceReplySchema.parse({
      type: 'instagramContext',
      requestId: input.requestId,
      records: [],
    }),
  ).toEqual({
    type: 'instagramContext',
    requestId: input.requestId,
    records: [],
  });
  const runtime = await readFile(
    new URL('./worker-runtime.ts', import.meta.url),
    'utf8',
  );
  expect(runtime).toContain("case 'getInstagramContext':");
  expect(runtime).toContain(
    "post({ type: 'instagramContext', requestId, records: [] });",
  );
});

test('real worker message handler answers context with no records even when the backing store carries one', async () => {
  const backing = createMemoryStore();
  const { writeInstagramContextContract } =
    await import('@socialprune/core/workspace/store-contract');
  const record = await writeInstagramContextContract(backing);
  const target = new EventTarget();
  const received: unknown[] = [];
  const waiting = new Map<string, (value: unknown) => void>();
  Object.assign(target, {
    postMessage(value: unknown) {
      received.push(value);
      const id = (value as { requestId?: string }).requestId;
      if (id) waiting.get(id)?.(value);
    },
  });
  vi.stubGlobal('self', target);
  vi.stubGlobal('navigator', {
    storage: {
      estimate: () => Promise.resolve({ usage: 0, quota: 0 }),
      persisted: () => Promise.resolve(false),
    },
  });
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage = null;
      postMessage() {}
      close() {}
    },
  );
  vi.doMock('./idb-store.ts', () => ({
    IndexedDBStore: { open: () => Promise.resolve(backing) },
    deleteWorkspaceDatabase: () => Promise.resolve(),
  }));
  vi.doMock('./registry.ts', () => ({
    publishWorkspace: () => Promise.resolve(),
    activeWorkspace: () => Promise.resolve('generated-context'),
    removeWorkspace: () => Promise.resolve(),
  }));
  const send = (input: WorkspaceRequest) =>
    new Promise<unknown>((resolve) => {
      waiting.set(input.requestId, resolve);
      const event = new Event('message');
      Object.defineProperty(event, 'data', { value: input });
      target.dispatchEvent(event);
    });
  try {
    await import('./worker-runtime.ts');
    expect(
      await send({
        type: 'open',
        requestId: 'open-context-worker',
        workspaceId: 'generated-context',
      }),
    ).toMatchObject({ type: 'opened' });
    expect(
      await send({
        type: 'getInstagramContext',
        requestId: 'read-context-worker',
        itemIds: [record.itemId],
      }),
    ).toEqual({
      type: 'instagramContext',
      requestId: 'read-context-worker',
      records: [],
    });
    expect(
      await backing.read((tx) => tx.instagramContext.get(record.itemId)),
    ).toEqual(record);
    expect(
      received.some((value) => (value as { type?: string }).type === 'failed'),
    ).toBe(false);
    await send({ type: 'shutdown', requestId: 'close-context-worker' });
  } finally {
    await backing.close();
    vi.doUnmock('./idb-store.ts');
    vi.doUnmock('./registry.ts');
    vi.unstubAllGlobals();
  }
});
