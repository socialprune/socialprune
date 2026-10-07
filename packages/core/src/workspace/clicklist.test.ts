import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import type {
  Assessment,
  Item,
  ItemKind,
  WorkspaceV2,
} from '../model/index.ts';
import { contractWorkspace } from './store-contract.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import type { WorkspaceStore } from './store.ts';
import { QueryEngine } from './query.ts';
import { ReviewService } from './review.ts';
import { ClickListSchema } from './payloads.ts';
import {
  HttpReviewRequestSchema,
  WorkspaceReplySchema,
  WorkspaceRequestSchema,
} from './protocol.ts';
import { xAdapter } from '../../../adapter-x/src/index.ts';
import { instagramAdapter } from '../../../adapter-instagram/src/index.ts';
import type { PlatformAdapter } from '../adapter/index.ts';

// This file did not exist on 8ef65fa. The tests were run before implementation
// so protocol rejection and the missing service were both observed.
async function clickList(store: WorkspaceStore) {
  const { ClickListService } = await import('./clicklist.ts');
  return new ClickListService(store, [xAdapter, instagramAdapter]);
}
function markedWorkspace(
  items: Item[],
  values: ('delete' | 'keep' | 'later')[] = items.map(() => 'delete'),
): WorkspaceV2 {
  const workspace = contractWorkspace();
  workspace.items = items;
  workspace.decisionEvents = items.map((item, index) => ({
    eventId: `marked-${index}`,
    seq: index + 1,
    itemId: item.id,
    value: values[index]!,
    previous: 'undecided',
    decidedAt: '2026-01-05T00:00:00.000Z',
    source: { kind: 'human', via: index % 2 ? 'local-review' : 'web-review' },
    action: {
      id: `marked-action-${index}`,
      kind: 'single',
      size: 1,
      reverts: null,
    },
  }));
  workspace.counts.items = items.length;
  workspace.counts.decisionEvents = items.length;
  return workspace;
}
function item(
  id: string,
  kind: ItemKind = 'post',
  date = '2026-01-01T00:00:00.000Z',
): Item {
  const template = contractWorkspace().items[0]!;
  return {
    ...template,
    id,
    kind,
    createdAt: date,
    text: `Generated click-list item ${id}.`,
    url: `https://example.invalid/${id}`,
    account: { key: 'x:contract', handle: null },
  };
}
function risk(itemId: string, value: number): Assessment {
  return {
    assessmentId: `risk-${itemId}`,
    submissionId: null,
    itemId,
    source: { kind: 'rules', name: 'hand-risks', version: null },
    risk: value,
    category: 'unclear',
    reason: 'Generated click-list risk reason.',
    evidence: null,
    confidence: null,
    createdAt: '2026-01-02T00:00:00.000Z',
  };
}
async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const part of chunks) {
    parts.push(part);
    length += part.byteLength;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

test('shared click-list requests have worker/HTTP parity, reject unknown types and cap windows at 200', () => {
  const requests = [
    {
      requestId: 'r1',
      type: 'clickListOpen',
      listId: 'list',
      accountKey: 'x:contract',
      timeZone: 'UTC',
      systemTimeZone: 'Europe/Berlin',
    },
    {
      requestId: 'r2',
      type: 'clickListWindow',
      listId: 'list',
      offset: 0,
      limit: 200,
    },
    { requestId: 'r3', type: 'clickListExport', listId: 'list', format: 'csv' },
  ];
  for (const schema of [WorkspaceRequestSchema, HttpReviewRequestSchema]) {
    for (const request of requests)
      expect(schema.safeParse(request).success).toBe(true);
    expect(schema.safeParse({ ...requests[1], limit: 201 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...requests[1], limit: 0 }).success).toBe(false);
    expect(
      schema.safeParse({ requestId: 'r', type: 'clickListUnknown' }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...requests[2], format: 'script' }).success).toBe(
      false,
    );
  }
  const complete = {
    requestId: 'r3',
    type: 'clickListExported',
    listId: 'list',
    revision: 0,
    format: 'csv',
    entries: 0,
    bytes: 3,
  };
  expect(WorkspaceReplySchema.safeParse(complete).success).toBe(true);
  const summary = {
    listId: 'list',
    accountKey: 'x:contract',
    timeZone: 'UTC',
    timeZoneSource: 'flag',
    revision: 0,
    total: 0,
    counts: { deletedByYou: 0, skipped: 0, left: 0 },
  };
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'r1',
      type: 'clickListOpened',
      ...summary,
    }).success,
  ).toBe(true);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'r2',
      type: 'clickListEntries',
      ...summary,
      offset: 0,
      entries: [],
    }).success,
  ).toBe(true);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'r3',
      type: 'clickListExportChunk',
      listId: 'list',
      revision: 0,
      format: 'csv',
      index: 0,
      chunk: '\uFEFFaccount',
    }).success,
  ).toBe(true);
  expect(
    WorkspaceReplySchema.safeParse({
      requestId: 'r3',
      type: 'clickListExportChunk',
      listId: 'list',
      revision: 0,
      format: 'csv',
      index: 0,
      chunk: 'a'.repeat(65_537),
    }).success,
  ).toBe(false);
});

test('click-list schema requires account and kind/time/outcome progress on every entry', () => {
  const data = {
    accountKey: 'x:contract',
    timeZone: 'UTC',
    timeZoneSource: 'flag',
    entries: [
      {
        itemId: 'x:1',
        platform: 'x',
        kind: 'post',
        createdAt: '2026-01-01T00:00:00.000Z',
        outcome: 'unknown',
        action: 'delete',
        url: null,
        day: '2026-01-01',
        text: 'Generated.',
        ownerHandle: null,
        via: 'web-review',
      },
    ],
  };
  expect(ClickListSchema.safeParse(data).success).toBe(true);
  expect(
    ClickListSchema.safeParse({
      ...data,
      entries: [{ ...data.entries[0], outcome: 'later' }],
    }).success,
  ).toBe(false);
});

test('X click list contains only delete decisions in risk/date/id order with adapter actions and one account', async () => {
  const items = [
    item('x:1', 'post'),
    item('x:2', 'reply'),
    item('x:3', 'quote'),
    item('x:4', 'repost'),
    item('x:5'),
    item('x:6'),
    { ...item('x:7'), account: { key: 'x:other', handle: null } },
  ];
  const workspace = markedWorkspace(items, [
    'delete',
    'delete',
    'delete',
    'delete',
    'keep',
    'later',
    'delete',
  ]);
  workspace.assessments = [
    risk('x:1', 1),
    risk('x:2', 3),
    risk('x:3', 2),
    risk('x:4', 0),
  ];
  workspace.counts.assessments = 4;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const service = await clickList(store);
    const opened = await service.open({
      listId: 'x-list',
      accountKey: 'x:contract',
      timeZone: 'UTC',
      systemTimeZone: 'Europe/Berlin',
    });
    expect(opened).toMatchObject({
      total: 4,
      counts: { deletedByYou: 0, skipped: 0, left: 4 },
      timeZone: 'UTC',
      timeZoneSource: 'flag',
    });
    const window = await service.window({
      listId: 'x-list',
      offset: 0,
      limit: 200,
    });
    expect(
      window.entries.map((entry) => [
        entry.itemId,
        entry.kind,
        entry.action,
        entry.via,
      ]),
    ).toEqual([
      ['x:2', 'reply', 'delete', 'local-review'],
      ['x:3', 'quote', 'delete', 'web-review'],
      ['x:1', 'post', 'delete', 'web-review'],
      ['x:4', 'repost', 'undo-repost', 'local-review'],
    ]);
    expect(window.entries.map((entry) => entry.url)).toEqual([
      'https://example.invalid/x:2',
      'https://example.invalid/x:3',
      'https://example.invalid/x:1',
      'https://example.invalid/x:4',
    ]);
    expect(
      window.entries.every(
        (entry) => entry.day === '2026-01-01' && entry.outcome === 'unknown',
      ),
    ).toBe(true);
  } finally {
    await store.close();
  }
});

test.each([
  ['Europe/Berlin', ['2026-03-29', '2026-03-29']],
  ['UTC', ['2026-03-29', '2026-03-28']],
] as const)(
  'Instagram newest-first list uses hand-computed days in %s for the requested DST-adjacent pair',
  async (timeZone, days) => {
    const items = ['2026-03-28T23:30:00.000Z', '2026-03-29T00:30:00.000Z'].map(
      (createdAt, index) => ({
        ...item(`instagram:${index}`, 'comment', createdAt),
        platform: 'instagram',
        account: { key: 'instagram:owner', handle: null },
        reference: {
          ...item('x:template').reference,
          ownerHandle: `post_owner_${index}`,
        },
      }),
    );
    const workspace = markedWorkspace(items);
    const store = createMemoryStore(new MemoryStoreBacking(workspace));
    try {
      const service = await clickList(store);
      await service.open({
        listId: 'instagram-list',
        accountKey: 'instagram:owner',
        timeZone,
        systemTimeZone: 'UTC',
      });
      const rows = (
        await service.window({
          listId: 'instagram-list',
          offset: 0,
          limit: 200,
        })
      ).entries;
      expect(
        rows.map((entry) => [
          entry.itemId,
          entry.action,
          entry.day,
          entry.ownerHandle,
        ]),
      ).toEqual([
        ['instagram:1', 'delete-comment', days[0], 'post_owner_1'],
        ['instagram:0', 'delete-comment', days[1], 'post_owner_0'],
      ]);
    } finally {
      await store.close();
    }
  },
);

test('outcomes and undo from a second review service appear on the next list window with fresh counts', async () => {
  const workspace = markedWorkspace([item('x:1'), item('x:2'), item('x:3')]);
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const review = new ReviewService(store, {
    via: 'local-review',
    query: new QueryEngine(store),
  });
  try {
    const service = await clickList(store);
    await service.open({
      listId: 'progress',
      accountKey: 'x:contract',
      systemTimeZone: 'UTC',
    });
    await review.outcome({
      commandId: 'did-it',
      itemIds: ['x:1'],
      value: 'deleted-by-user',
      expected: { 'x:1': 'unknown' },
    });
    await review.outcome({
      commandId: 'skip',
      itemIds: ['x:2'],
      value: 'skipped',
      expected: { 'x:2': 'unknown' },
    });
    let window = await service.window({
      listId: 'progress',
      offset: 0,
      limit: 200,
    });
    expect(window).toMatchObject({
      counts: { deletedByYou: 1, skipped: 1, left: 1 },
    });
    expect(
      window.entries.map((entry) => [entry.itemId, entry.outcome]),
    ).toEqual([
      ['x:1', 'deleted-by-user'],
      ['x:2', 'skipped'],
      ['x:3', 'unknown'],
    ]);
    await review.undo('undo-skip');
    window = await service.window({
      listId: 'progress',
      offset: 0,
      limit: 200,
    });
    expect(window).toMatchObject({
      counts: { deletedByYou: 1, skipped: 0, left: 2 },
    });
    expect(
      window.entries.find((entry) => entry.itemId === 'x:2')?.outcome,
    ).toBe('unknown');
    await review.decide({
      commandId: 'keep-after-open',
      itemIds: ['x:3'],
      value: 'keep',
      expected: { 'x:3': 'delete' },
    });
    window = await service.window({
      listId: 'progress',
      offset: 0,
      limit: 200,
    });
    expect(window.total).toBe(2);
    expect(window.entries.map((entry) => entry.itemId)).toEqual(['x:1', 'x:2']);
  } finally {
    await store.close();
  }
});

test('warm windows use at most their limit item reads and no assessment, event or state scans', async () => {
  const base = createMemoryStore(
    new MemoryStoreBacking(
      markedWorkspace(
        Array.from({ length: 300 }, (_, index) => item(`x:${index}`)),
      ),
    ),
  );
  let itemReads = 0,
    forbidScans = false;
  const store: WorkspaceStore = {
    read: (operation) =>
      base.read((tx) =>
        operation({
          ...tx,
          items: {
            ...tx.items,
            get(id) {
              itemReads++;
              return tx.items.get(id);
            },
          },
          assessments: {
            iterate(options) {
              if (forbidScans) throw new Error('Unbounded assessment scan.');
              return tx.assessments.iterate(options);
            },
          },
          decisionEvents: {
            iterate(options) {
              if (forbidScans) throw new Error('Unbounded decision scan.');
              return tx.decisionEvents.iterate(options);
            },
          },
          outcomeEvents: {
            iterate(options) {
              if (forbidScans) throw new Error('Unbounded outcome scan.');
              return tx.outcomeEvents.iterate(options);
            },
          },
          state: {
            ...tx.state,
            iterate(options) {
              if (forbidScans) throw new Error('Unbounded state scan.');
              return tx.state.iterate(options);
            },
          },
        }),
      ),
    write: (operation) => base.write(operation),
    close: () => base.close(),
  };
  try {
    const service = await clickList(store);
    await service.open({
      listId: 'bounded',
      accountKey: 'x:contract',
      systemTimeZone: 'UTC',
    });
    itemReads = 0;
    forbidScans = true;
    expect(
      (await service.window({ listId: 'bounded', offset: 30, limit: 200 }))
        .entries,
    ).toHaveLength(200);
    expect(itemReads).toBe(200);
    await expect(
      service.window({ listId: 'bounded', offset: 0, limit: 201 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  } finally {
    await base.close();
  }
});

test('CSV matches a hand-written expected UTF-8 BOM file and JSON validates, including injection fixture text', async () => {
  const injection = await readFile(
    new URL(
      '../../../../fixtures/synthetic/x/injection/archive/data/tweets.js',
      import.meta.url,
    ),
    'utf8',
  );
  const marker = /"full_text":("(?:[^"\\]|\\.)*")/.exec(injection);
  expect(marker).not.toBeNull();
  const fixtureText: unknown = JSON.parse(marker![1]!);
  expect(fixtureText).toBe('Injection text must not import.');
  const texts = [
    '=HYPERLINK("https://example.com")',
    '+1',
    '-2',
    '@SUM(A1)',
    '\tleading tab',
    'comma, "quote"\nnext',
    'Äpfel 😺',
    fixtureText as string,
  ];
  const items = texts.map((text, index) => ({
    ...item(`x:${index + 1}`),
    text,
    url: null,
  }));
  const workspace = markedWorkspace(items);
  workspace.decisionEvents.forEach((event) => {
    event.source.via = 'web-review';
  });
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const service = await clickList(store);
    await service.open({
      listId: 'csv-test',
      accountKey: 'x:contract',
      systemTimeZone: 'UTC',
    });
    const exported = await collect(
      service.export({ listId: 'csv-test', format: 'csv', chunkBytes: 31 }),
    );
    const expected: unknown = JSON.parse(
      await readFile(
        new URL('./clicklist.expected.json', import.meta.url),
        'utf8',
      ),
    );
    expect(typeof expected).toBe('string');
    expect([...exported.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(exported).toEqual(new TextEncoder().encode(expected as string));
    const json = await collect(
      service.export({ listId: 'csv-test', format: 'json', chunkBytes: 37 }),
    );
    const data: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(json),
    );
    expect(
      ClickListSchema.parse(data).entries.map((entry) => entry.text),
    ).toEqual(texts);
    const generated: unknown = JSON.parse(
      await readFile(
        new URL('../../schemas/click-list.schema.json', import.meta.url),
        'utf8',
      ),
    );
    expect(generated).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    });
    const schema = generated as {
      required: string[];
      properties: { entries: { items: { required: string[] } } };
    };
    expect(schema.required).toEqual([
      'accountKey',
      'timeZone',
      'timeZoneSource',
      'entries',
    ]);
    for (const entry of ClickListSchema.parse(data).entries)
      for (const key of schema.properties.entries.items.required)
        expect(entry).toHaveProperty(key);
    const planted = globalThis as typeof globalThis & { __pwned?: unknown };
    expect(planted.__pwned).toBeUndefined();
  } finally {
    await store.close();
  }
});

test('adapter-declared order supports a new platform without a core platform switch', async () => {
  const module = await import('./clicklist.ts');
  const items = [0, 1].map((index) => ({
    ...item(`new-platform:${index}`),
    platform: 'new-platform',
    account: { key: 'new-platform:account', handle: null },
    createdAt: index === 0 ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z',
  }));
  const store = createMemoryStore(
    new MemoryStoreBacking(markedWorkspace(items)),
  );
  const adapter: PlatformAdapter = {
    platform: 'new-platform',
    name: 'hand-adapter',
    version: '1',
    clickListOrder: 'day',
    detect: () =>
      Promise.resolve({
        result: 'no-match',
        variant: null,
        reason: 'Not used.',
      }),
    async *parse() {
      await Promise.resolve();
      yield { type: 'meta', exportCreatedAt: null };
    },
    deletionHint: (item) => ({ action: 'delete', url: item.url, group: null }),
  };
  try {
    const service = new module.ClickListService(store, [adapter]);
    await service.open({
      listId: 'new-platform-list',
      accountKey: 'new-platform:account',
      systemTimeZone: 'UTC',
    });
    expect(
      (
        await service.window({
          listId: 'new-platform-list',
          offset: 0,
          limit: 200,
        })
      ).entries.map((entry) => entry.itemId),
    ).toEqual(['new-platform:1', 'new-platform:0']);
  } finally {
    await store.close();
  }
});

test('CSV neutralizes a leading CR and protects untrusted metadata cells as well as text', async () => {
  const created = item('x:1');
  created.account.key = '@account';
  created.text = '\rleading carriage return';
  created.url = '=url';
  created.reference.ownerHandle = '+owner';
  const store = createMemoryStore(
    new MemoryStoreBacking(markedWorkspace([created])),
  );
  try {
    const service = await clickList(store);
    await service.open({
      listId: 'metadata-csv',
      accountKey: '@account',
      systemTimeZone: 'UTC',
    });
    const csv = new TextDecoder().decode(
      await collect(service.export({ listId: 'metadata-csv', format: 'csv' })),
    );
    expect(csv).toContain("'@account,x,x:1");
    expect(csv).toContain(
      ",'=url,'+owner,web-review,unknown,\"'\rleading carriage return\"\r\n",
    );
  } finally {
    await store.close();
  }
});

test('JSON and CSV exports reject a changed revision and abort instead of finishing a mixed document', async () => {
  const workspace = markedWorkspace(
    Array.from({ length: 220 }, (_, index) => item(`x:${index}`)),
  );
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const review = new ReviewService(store, {
    query: new QueryEngine(store),
    via: 'local-review',
  });
  try {
    const service = await clickList(store);
    await service.open({
      listId: 'changing-export',
      accountKey: 'x:contract',
      systemTimeZone: 'UTC',
    });
    const iterator = service
      .export({ listId: 'changing-export', format: 'json', chunkBytes: 1024 })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await review.outcome({
      commandId: 'during-export',
      itemIds: ['x:1'],
      value: 'skipped',
      expected: { 'x:1': 'unknown' },
    });
    const consume = async () => {
      while (!(await iterator.next()).done) {
        /* Consume until revision validation fails. */
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: 'STALE' });
    const controller = new AbortController();
    const cancelled = service
      .export({
        listId: 'changing-export',
        format: 'csv',
        chunkBytes: 1024,
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    await cancelled.next();
    controller.abort();
    await expect(cancelled.next()).rejects.toMatchObject({
      name: 'AbortError',
    });
  } finally {
    await store.close();
  }
});

test('a same-engine human decision updates via without a new event scan and empty accounts produce valid empty exports', async () => {
  const workspace = markedWorkspace([item('x:1')]);
  workspace.imports = [
    {
      id: 'empty-import',
      platform: 'x',
      importedAt: '2026-01-01T00:00:00Z',
      exportCreatedAt: null,
      archives: ['empty'],
      accounts: [{ key: 'x:empty', handle: null }],
      adapter: { name: 'hand-adapter', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 0,
      status: 'complete',
    },
  ];
  workspace.counts.imports = 1;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const query = new QueryEngine(store);
  const review = new ReviewService(store, { query, via: 'local-review' });
  const { ClickListService } = await import('./clicklist.ts');
  try {
    const service = new ClickListService(store, [xAdapter], { query });
    await service.open({
      listId: 'same-query',
      accountKey: 'x:contract',
      systemTimeZone: 'UTC',
    });
    await review.decide({
      commandId: 'local-keep',
      itemIds: ['x:1'],
      value: 'keep',
      expected: { 'x:1': 'delete' },
    });
    await review.decide({
      commandId: 'local-delete',
      itemIds: ['x:1'],
      value: 'delete',
      expected: { 'x:1': 'keep' },
    });
    expect(
      (await service.window({ listId: 'same-query', offset: 0, limit: 200 }))
        .entries[0]?.via,
    ).toBe('local-review');
    const empty = await service.open({
      listId: 'empty-account',
      accountKey: 'x:empty',
      systemTimeZone: 'UTC',
    });
    expect(empty).toMatchObject({
      total: 0,
      counts: { deletedByYou: 0, skipped: 0, left: 0 },
    });
    const json: unknown = JSON.parse(
      new TextDecoder().decode(
        await collect(
          service.export({ listId: 'empty-account', format: 'json' }),
        ),
      ),
    );
    expect(ClickListSchema.parse(json)).toEqual({
      accountKey: 'x:empty',
      timeZone: 'UTC',
      timeZoneSource: 'system',
      entries: [],
    });
  } finally {
    await store.close();
  }
});

test('Instagram day grouping uses separate Berlin days across midnight and keeps the DST transition on the same day', async () => {
  const dates = [
    '2026-03-28T22:30:00.000Z',
    '2026-03-28T23:30:00.000Z',
    '2026-03-29T01:30:00.000Z',
  ];
  const items = dates.map((createdAt, index) => ({
    ...item(`instagram:${index}`, 'comment', createdAt),
    platform: 'instagram',
    account: { key: 'instagram:owner', handle: null },
  }));
  const workspace = markedWorkspace(items);
  workspace.settings.timeZone = 'Europe/Berlin';
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const service = await clickList(store);
    expect(
      await service.open({
        listId: 'berlin-midnight',
        accountKey: 'instagram:owner',
        systemTimeZone: 'UTC',
      }),
    ).toMatchObject({ timeZone: 'Europe/Berlin', timeZoneSource: 'workspace' });
    const entries = (
      await service.window({ listId: 'berlin-midnight', offset: 0, limit: 200 })
    ).entries;
    expect(entries.map((entry) => [entry.itemId, entry.day])).toEqual([
      ['instagram:2', '2026-03-29'],
      ['instagram:1', '2026-03-29'],
      ['instagram:0', '2026-03-28'],
    ]);
  } finally {
    await store.close();
  }
});

test('a commit after the item-read snapshot is detected before a list window is published', async () => {
  const base = createMemoryStore(
    new MemoryStoreBacking(markedWorkspace([item('x:1')])),
  );
  let afterRead: (() => Promise<void>) | undefined;
  const store: WorkspaceStore = {
    async read(operation) {
      const result = await base.read(operation);
      const change = afterRead;
      afterRead = undefined;
      await change?.();
      return result;
    },
    write: (operation) => base.write(operation),
    close: () => base.close(),
  };
  try {
    const service = await clickList(store);
    await service.open({
      listId: 'racing-window',
      accountKey: 'x:contract',
      systemTimeZone: 'UTC',
    });
    const review = new ReviewService(base, {
      query: new QueryEngine(base),
      via: 'local-review',
    });
    afterRead = async () => {
      await review.outcome({
        commandId: 'raced-outcome',
        itemIds: ['x:1'],
        value: 'skipped',
        expected: { 'x:1': 'unknown' },
      });
    };
    const window = await service.window({
      listId: 'racing-window',
      offset: 0,
      limit: 200,
    });
    expect(window).toMatchObject({
      revision: 1,
      counts: { skipped: 1, deletedByYou: 0, left: 0 },
    });
    expect(window.entries[0]?.outcome).toBe('skipped');
  } finally {
    await base.close();
  }
});

test('a marked item from an incomplete import stays absent until the import becomes complete', async () => {
  const workspace = markedWorkspace([item('x:1')]);
  workspace.imports = [
    {
      id: 'pending-import',
      platform: 'x',
      importedAt: '2026-01-01T00:00:00Z',
      exportCreatedAt: null,
      archives: ['contract'],
      accounts: [workspace.items[0]!.account],
      adapter: { name: 'hand-adapter', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 1,
      status: 'incomplete',
    },
  ];
  workspace.counts.imports = 1;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const service = await clickList(store);
    expect(
      await service.open({
        listId: 'pending',
        accountKey: 'x:contract',
        systemTimeZone: 'UTC',
      }),
    ).toMatchObject({ total: 0 });
    await store.write(async (tx) => {
      const record = await tx.imports.get('pending-import');
      await tx.imports.put({ ...record!, status: 'complete' });
      await tx.runtime.set({ revision: 1 });
    });
    expect(
      (
        await service.window({ listId: 'pending', offset: 0, limit: 200 })
      ).entries.map((entry) => entry.itemId),
    ).toEqual(['x:1']);
  } finally {
    await store.close();
  }
});
