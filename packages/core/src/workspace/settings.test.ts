import { expect, test } from 'vitest';
import { contractWorkspace } from './store-contract.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { readWorkspace } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { ClickListService } from './clicklist.ts';
import { QueryEngine } from './query.ts';
import { createBackup, restoreBackup } from './backup.ts';
import {
  HttpReviewRequestSchema,
  WorkspaceReplySchema,
  WorkspaceRequestSchema,
} from './protocol.ts';
import { instagramAdapter } from '../../../adapter-instagram/src/index.ts';

const INVALID_ZONES = ['Europe/Nowhere', '', 'x'.repeat(200)];

async function settings(store: WorkspaceStore) {
  // This module and the positive transport cases were executed as missing
  // before implementation to prove the 1965c5c contract cannot satisfy them.
  const { SettingsService } = await import('./settings.ts');
  return new SettingsService(store, {
    now: () => new Date('2026-04-01T00:00:00.000Z'),
  });
}

function boundaryWorkspace() {
  const workspace = contractWorkspace();
  const template = workspace.items[0]!;
  workspace.settings.timeZone = null;
  workspace.items = [
    {
      ...template,
      id: 'instagram:1',
      platform: 'instagram',
      kind: 'comment' as const,
      account: { key: 'instagram:contract', handle: null },
      createdAt: '2026-03-28T22:30:00.000Z',
    },
    {
      ...template,
      id: 'instagram:2',
      platform: 'instagram',
      kind: 'comment' as const,
      account: { key: 'instagram:contract', handle: null },
      createdAt: '2026-03-28T23:30:00.000Z',
    },
  ];
  workspace.decisionEvents = workspace.items.map((item, index) => ({
    eventId: `boundary-${index}`,
    seq: index + 1,
    itemId: item.id,
    previous: 'undecided' as const,
    value: 'delete' as const,
    decidedAt: '2026-03-29T00:00:00.000Z',
    source: { kind: 'human' as const, via: 'web-review' as const },
    action: {
      id: `boundary-action-${index}`,
      kind: 'single' as const,
      size: 1,
      reverts: null,
    },
  }));
  workspace.counts.items = 2;
  workspace.counts.decisionEvents = 2;
  return workspace;
}

test('setTimeZone validates nullable IANA settings with worker/HTTP parity and a symbolic reply', () => {
  for (const schema of [WorkspaceRequestSchema, HttpReviewRequestSchema]) {
    for (const timeZone of ['Europe/Berlin', 'UTC', 'Asia/Tokyo', null])
      expect(
        schema.safeParse({
          requestId: 'settings-request',
          type: 'setTimeZone',
          timeZone,
        }).success,
      ).toBe(true);
    for (const timeZone of INVALID_ZONES)
      expect(
        schema.safeParse({
          requestId: 'settings-request',
          type: 'setTimeZone',
          timeZone,
        }).success,
      ).toBe(false);
    expect(
      schema.safeParse({ requestId: 'settings-request', type: 'setTimeZone' })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        requestId: 'settings-request',
        type: 'setTimeZone',
        timeZone: null,
        extra: true,
      }).success,
    ).toBe(false);
  }
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'settings-request',
      type: 'settingsChanged',
      timeZone: 'Europe/Berlin',
      revision: 1,
    }).success,
  ).toBe(true);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'settings-request',
      type: 'settingsChanged',
      timeZone: null,
      revision: 2,
    }).success,
  ).toBe(true);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'settings-request',
      type: 'settingsChanged',
      timeZone: 'Europe/Nowhere',
      revision: 1,
    }).success,
  ).toBe(false);
});

test('deleteWorkspace is a strict browser-only request and core supplies its reply, not a storage deletion', () => {
  const request = {
    requestId: 'delete-request',
    type: 'deleteWorkspace',
    workspaceId: 'boundary-workspace',
  };
  expect(WorkspaceRequestSchema.safeParse(request).success).toBe(true);
  expect(HttpReviewRequestSchema.safeParse(request).success).toBe(false);
  expect(
    WorkspaceRequestSchema.safeParse({ ...request, workspaceId: '' }).success,
  ).toBe(false);
  expect(
    WorkspaceRequestSchema.safeParse({ ...request, extra: true }).success,
  ).toBe(false);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'delete-request',
      type: 'workspaceDeleted',
      workspaceId: 'boundary-workspace',
    }).success,
  ).toBe(true);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'delete-request',
      type: 'workspaceDeleted',
      workspaceId: 'boundary-workspace',
      error: 'PLANTED_RAW_ERROR',
    }).success,
  ).toBe(false);
});

test('setting and clearing the zone each writes once, raises the revision once and appends no event', async () => {
  const input = boundaryWorkspace();
  const base = createMemoryStore(new MemoryStoreBacking(input));
  let writes = 0;
  const store: WorkspaceStore = {
    read: (operation) => base.read(operation),
    write: (operation) => {
      writes++;
      return base.write(operation);
    },
    close: () => base.close(),
  };
  try {
    const service = await settings(store);
    expect(await service.setTimeZone('Europe/Berlin')).toEqual({
      timeZone: 'Europe/Berlin',
      revision: 1,
    });
    expect(writes).toBe(1);
    expect(await base.read(async (tx) => tx.runtime.get())).toEqual({
      revision: 1,
      lastEventSeq: 2,
    });
    const after = await base.read(readWorkspace);
    expect(after.settings).toEqual({
      ...input.settings,
      timeZone: 'Europe/Berlin',
    });
    expect(after.updatedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(after.items).toEqual(input.items);
    expect(after.assessments).toEqual(input.assessments);
    expect(after.decisionEvents).toEqual(input.decisionEvents);
    expect(after.outcomeEvents).toEqual(input.outcomeEvents);
    expect(after.submissions).toEqual(input.submissions);
    expect(await service.setTimeZone(null)).toEqual({
      timeZone: null,
      revision: 2,
    });
    expect(writes).toBe(2);
    expect(
      (await base.read(async (tx) => tx.meta.get())).settings.timeZone,
    ).toBeNull();
    expect((await base.read(readWorkspace)).decisionEvents).toEqual(
      input.decisionEvents,
    );
  } finally {
    await base.close();
  }
});

test('open Instagram click lists re-resolve the stored zone after setting and clearing without losing explicit flags', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(boundaryWorkspace()));
  try {
    const service = await settings(store);
    const lists = new ClickListService(store, [instagramAdapter]);
    const first = await lists.open({
      listId: 'live-zone',
      accountKey: 'instagram:contract',
      systemTimeZone: 'UTC',
    });
    expect(first).toMatchObject({
      timeZone: 'UTC',
      timeZoneSource: 'system',
      revision: 0,
    });
    expect(
      (
        await lists.window({ listId: 'live-zone', offset: 0, limit: 200 })
      ).entries.map((entry) => [entry.itemId, entry.day]),
    ).toEqual([
      ['instagram:2', '2026-03-28'],
      ['instagram:1', '2026-03-28'],
    ]);
    await lists.open({
      listId: 'flag-zone',
      accountKey: 'instagram:contract',
      timeZone: 'UTC',
      systemTimeZone: 'Asia/Tokyo',
    });
    await service.setTimeZone('Europe/Berlin');
    const current = await lists.window({
      listId: 'live-zone',
      offset: 0,
      limit: 200,
    });
    expect(current).toMatchObject({
      timeZone: 'Europe/Berlin',
      timeZoneSource: 'workspace',
      revision: 1,
    });
    // 22:30 UTC is 23:30 CET on the 28th; 23:30 UTC is 00:30 CET on the 29th.
    expect(current.entries.map((entry) => [entry.itemId, entry.day])).toEqual([
      ['instagram:2', '2026-03-29'],
      ['instagram:1', '2026-03-28'],
    ]);
    expect(
      await lists.open({
        listId: 'new-zone',
        accountKey: 'instagram:contract',
        systemTimeZone: 'UTC',
      }),
    ).toMatchObject({ timeZone: 'Europe/Berlin', timeZoneSource: 'workspace' });
    const flagged = await lists.window({
      listId: 'flag-zone',
      offset: 0,
      limit: 200,
    });
    expect(flagged).toMatchObject({ timeZone: 'UTC', timeZoneSource: 'flag' });
    expect(flagged.entries.every((entry) => entry.day === '2026-03-28')).toBe(
      true,
    );
    await service.setTimeZone(null);
    expect(
      await lists.window({ listId: 'live-zone', offset: 0, limit: 200 }),
    ).toMatchObject({ timeZone: 'UTC', timeZoneSource: 'system', revision: 2 });
    expect(
      await lists.open({
        listId: 'cleared-zone',
        accountKey: 'instagram:contract',
        systemTimeZone: 'America/Los_Angeles',
      }),
    ).toMatchObject({
      timeZone: 'America/Los_Angeles',
      timeZoneSource: 'system',
    });
  } finally {
    await store.close();
  }
});

test.each([false, true])(
  'date query settings dependency refreshes with or without noteChanged: %s',
  async (notify) => {
    const input = boundaryWorkspace();
    input.settings.timeZone = 'UTC';
    const store = createMemoryStore(new MemoryStoreBacking(input));
    try {
      const service = await settings(store);
      const query = new QueryEngine(store);
      const filter = { dates: { from: '2026-03-29', to: '2026-03-29' } };
      const run = (generation: number) =>
        query.query({
          queryId: 'day-query',
          generation,
          accountKey: 'instagram:contract',
          filter,
        });
      expect((await run(1)).total).toBe(0);
      const set = await service.setTimeZone('Europe/Berlin');
      if (notify)
        await query.noteChanged({ revision: set.revision, itemIds: [] });
      expect((await run(2)).total).toBe(1);
      expect((await query.selection('day-query', 2)).ids).toEqual([
        'instagram:2',
      ]);
    } finally {
      await store.close();
    }
  },
);

test('invalid zone service calls reject INVALID_REQUEST before any write or mutation', async () => {
  const input = boundaryWorkspace();
  const base = createMemoryStore(new MemoryStoreBacking(input));
  let writes = 0;
  const store: WorkspaceStore = {
    read: (operation) => base.read(operation),
    write: (operation) => {
      writes++;
      return base.write(operation);
    },
    close: () => base.close(),
  };
  try {
    const service = await settings(store);
    for (const zone of INVALID_ZONES) {
      await expect(service.setTimeZone(zone)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
      expect(await base.read(readWorkspace)).toEqual(input);
    }
    expect(writes).toBe(0);
    expect(await base.read(async (tx) => tx.runtime.get())).toEqual({
      revision: 0,
      lastEventSeq: 2,
    });
  } finally {
    await base.close();
  }
});

test('zone write failure rolls back settings and revision without exposing the storage error', async () => {
  const input = boundaryWorkspace();
  const base = createMemoryStore(new MemoryStoreBacking(input));
  const fault: WorkspaceStore = {
    read: (operation) => base.read(operation),
    write: (operation) =>
      base.write(async (tx) => {
        await operation(tx);
        throw new Error('PLANTED_STORAGE_ERROR');
      }),
    close: () => base.close(),
  };
  try {
    const service = await settings(fault);
    await expect(service.setTimeZone('Europe/Berlin')).rejects.toMatchObject({
      code: 'STORAGE',
      message: 'STORAGE',
    });
    expect(await base.read(readWorkspace)).toEqual(input);
    expect(await base.read(async (tx) => tx.runtime.get())).toEqual({
      revision: 0,
      lastEventSeq: 2,
    });
  } finally {
    await base.close();
  }
});

test('the real streamed backup and staging restore preserve the chosen workspace zone', async () => {
  const source = createMemoryStore(new MemoryStoreBacking(boundaryWorkspace()));
  const stage = createMemoryStore();
  try {
    const service = await settings(source);
    await service.setTimeZone('Europe/Berlin');
    const session = createBackup(source, {
      now: new Date('2026-04-02T00:00:00.000Z'),
      chunkBytes: 73,
    });
    const restored = await restoreBackup(stage, session.chunks, {
      batchSize: 1,
    });
    await session.complete();
    expect(restored.meta.settings.timeZone).toBe('Europe/Berlin');
    expect(
      (await stage.read(async (tx) => tx.meta.get())).settings.timeZone,
    ).toBe('Europe/Berlin');
    const lists = new ClickListService(stage, [instagramAdapter]);
    expect(
      await lists.open({
        listId: 'restored-zone',
        accountKey: 'instagram:contract',
        systemTimeZone: 'UTC',
      }),
    ).toMatchObject({ timeZone: 'Europe/Berlin', timeZoneSource: 'workspace' });
    expect(
      (
        await lists.window({ listId: 'restored-zone', offset: 0, limit: 200 })
      ).entries.map((entry) => entry.day),
    ).toEqual(['2026-03-29', '2026-03-28']);
  } finally {
    await source.close();
    await stage.close();
  }
});

test('a caller-supplied workspace-zone snapshot is replaced after the stored setting changes', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(boundaryWorkspace()));
  try {
    const service = await settings(store);
    const lists = new ClickListService(store, [instagramAdapter]);
    await lists.open({
      listId: 'snapshot-zone',
      accountKey: 'instagram:contract',
      workspaceTimeZone: 'UTC',
      systemTimeZone: 'Asia/Tokyo',
    });
    await service.setTimeZone('Europe/Berlin');
    expect(
      await lists.window({ listId: 'snapshot-zone', offset: 0, limit: 200 }),
    ).toMatchObject({
      timeZone: 'Europe/Berlin',
      timeZoneSource: 'workspace',
      revision: 1,
    });
    await service.setTimeZone(null);
    expect(
      await lists.window({ listId: 'snapshot-zone', offset: 0, limit: 200 }),
    ).toMatchObject({
      timeZone: 'Asia/Tokyo',
      timeZoneSource: 'system',
      revision: 2,
    });
  } finally {
    await store.close();
  }
});

test('a setting commit during list refresh cannot publish old-zone days under the new revision', async () => {
  const base = createMemoryStore(new MemoryStoreBacking(boundaryWorkspace()));
  let afterRead: (() => Promise<void>) | undefined;
  const store: WorkspaceStore = {
    async read(operation) {
      const result = await base.read(operation);
      if (
        result &&
        typeof result === 'object' &&
        'meta' in result &&
        'revision' in result
      ) {
        const commit = afterRead;
        afterRead = undefined;
        await commit?.();
      }
      return result;
    },
    write: (operation) => base.write(operation),
    close: () => base.close(),
  };
  try {
    const lists = new ClickListService(store, [instagramAdapter]);
    await lists.open({
      listId: 'racing-zone',
      accountKey: 'instagram:contract',
      systemTimeZone: 'UTC',
    });
    const service = await settings(base);
    await service.setTimeZone('UTC');
    afterRead = async () => {
      await service.setTimeZone('Europe/Berlin');
    };
    const window = await lists.window({
      listId: 'racing-zone',
      offset: 0,
      limit: 200,
    });
    expect(window).toMatchObject({
      timeZone: 'Europe/Berlin',
      timeZoneSource: 'workspace',
      revision: 2,
    });
    expect(window.entries.map((entry) => entry.day)).toEqual([
      '2026-03-29',
      '2026-03-28',
    ]);
  } finally {
    await base.close();
  }
});
