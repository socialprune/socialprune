import { expect, test, vi } from 'vitest';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import { WorkspaceClient } from './client.ts';
import type { WorkspacePort } from './client.ts';
import type { WorkspaceRequest } from '@socialprune/core/workspace/protocol';

test('real worker switch and client carry all five feed requests, settings and page-bound previews', async () => {
  const backing = createMemoryStore();
  const outbound = new EventTarget();
  const scope = new EventTarget();
  const waiting = new Map<string, (value: unknown) => void>();
  Object.assign(scope, {
    postMessage(data: unknown) {
      outbound.dispatchEvent(new MessageEvent('message', { data }));
      const id = (data as { requestId?: string }).requestId;
      if (id) waiting.get(id)?.(data);
    },
  });
  Object.assign(outbound, {
    postMessage(data: unknown) {
      const event = new Event('message');
      Object.defineProperty(event, 'data', { value: data });
      scope.dispatchEvent(event);
    },
    terminate() {},
  });
  vi.stubGlobal('self', scope);
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
    activeWorkspace: () => Promise.resolve('generated-feed'),
    removeWorkspace: () => Promise.resolve(),
  }));
  try {
    await import('./worker-runtime.ts');
    const client = new WorkspaceClient(outbound as WorkspacePort);
    expect(await client.open('generated-feed')).toMatchObject({
      type: 'opened',
      summary: {
        criteria: { selected: [] },
        keepRules: [{ kind: 'top-liked-tenth' }],
      },
    });
    expect(await client.planCounts('x:generated')).toMatchObject({
      type: 'planCounts',
      tabs: { all: 0, suggested: 0 },
    });
    expect(
      await client.feedWindow({
        accountKey: 'x:generated',
        tab: 'all',
        offset: 0,
        limit: 50,
      }),
    ).toMatchObject({ type: 'feedCards', total: 0, cards: [] });
    const changed = client.setCriteria({
      selected: ['political'],
      custom: [],
      nextCustom: 1,
      level: 1,
    });
    await client.flushCommands();
    expect(await changed).toMatchObject({
      type: 'settingsChanged',
      revision: 0,
    });
    expect(client.summary?.criteria?.selected).toEqual(['political']);
    expect(await client.setKeepRules([])).toMatchObject({
      type: 'settingsChanged',
      keepRules: [],
      revision: 0,
    });
    expect(client.summary?.keepRules).toEqual([]);
    const preview = await client.previewPlan({
      accountKey: 'x:generated',
      pageId: 'page',
      previewId: 'plan',
    });
    expect(preview).toMatchObject({
      type: 'bulkPreview',
      willChange: 0,
      plan: { criteria: [{ id: 'political' }], level: 1 },
    });
    expect(
      await client.request({
        type: 'confirmBulk',
        requestId: 'wrong',
        commandId: 'wrong',
        pageId: 'other',
        previewId: 'plan',
      }),
    ).toMatchObject({ type: 'rejected', code: 'PREVIEW_EXPIRED' });
    expect(
      await client.request({
        type: 'confirmBulk',
        requestId: 'confirm',
        commandId: 'confirm',
        pageId: 'page',
        previewId: 'plan',
      }),
    ).toMatchObject({ type: 'committed', changed: 0 });
    expect(client.diagnostics).toEqual([]);
    expect(
      await client.request({
        type: 'shutdown',
        requestId: 'close',
      } satisfies WorkspaceRequest),
    ).toMatchObject({ type: 'done' });
    client.dispose();
  } finally {
    await backing.close();
    vi.doUnmock('./idb-store.ts');
    vi.doUnmock('./registry.ts');
    vi.unstubAllGlobals();
  }
}, 60_000);
