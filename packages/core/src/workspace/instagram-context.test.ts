import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import {
  BrowserAttemptSchema,
  BrowserRunSchema,
  BrowserRequestSchema,
  InstagramContextSchema,
  WORKSPACE_SCHEMA_VERSION,
} from '../model/index.ts';
import type { Item, WorkspaceV2 } from '../model/index.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import {
  instagramContractItem,
  instagramContractRecord,
  writeInstagramContextContract,
} from './store-contract.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';
import { createBackup, readBackup, restoreBackup } from './backup.ts';
import { validateWorkspace } from './validation.ts';
import {
  GetInstagramContextRequestSchema,
  InstagramContextReplySchema,
  HttpReviewRequestSchema,
  WorkspaceRequestSchema,
} from './protocol.ts';

const chunks = (value: unknown) =>
  (async function* () {
    await Promise.resolve();
    yield JSON.stringify(value);
  })();
async function fixture(): Promise<WorkspaceV2> {
  const expected = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/instagram/current-minimal/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { items: Item[] };
  const contract = instagramContractItem();
  expect(expected.items[0]).toMatchObject({
    id: contract.id,
    platform: contract.platform,
    account: contract.account,
    text: contract.text,
    createdAt: contract.createdAt,
    reference: contract.reference,
  });
  const store = createMemoryStore();
  try {
    await writeInstagramContextContract(store, expected.items[0]);
    return await store.read(readWorkspace);
  } finally {
    await store.close();
  }
}

test('confirmed memory record agrees with independent fixture and survives both readers in reversed property order', async () => {
  const value = await fixture();
  expect(validateWorkspace(value)).toEqual(value);
  expect(value.instagramContext).toEqual([instagramContractRecord()]);
  expect(value.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  expect((await readBackup(chunks(reordered))).instagramContext).toEqual(
    value.instagramContext,
  );
  const target = createMemoryStore();
  try {
    await restoreBackup(target, chunks(reordered), { batchSize: 1 });
    expect((await target.read(readWorkspace)).instagramContext).toEqual(
      value.instagramContext,
    );
  } finally {
    await target.close();
  }
});

// These documents pin the shipped version, not the moving writer version.
test('literal schema 5 remains readable through validateWorkspace after the writer version advances', async () => {
  const value = { ...(await fixture()), schemaVersion: 5 as const };
  expect(validateWorkspace(value)).toEqual(value);
});

test('literal schema 5 remains readable through readBackup after the writer version advances', async () => {
  const value = { ...(await fixture()), schemaVersion: 5 as const };
  expect(await readBackup(chunks(value))).toEqual(value);
});

test('literal schema 5 remains readable through streaming restoreBackup after the writer version advances', async () => {
  const value = { ...(await fixture()), schemaVersion: 5 as const };
  for (const document of [
    value,
    Object.fromEntries(Object.entries(value).reverse()),
  ]) {
    const target = createMemoryStore();
    try {
      await restoreBackup(target, chunks(document), { batchSize: 1 });
      expect((await target.read(readWorkspace)).instagramContext).toEqual(
        value.instagramContext,
      );
    } finally {
      await target.close();
    }
  }
});

test('context writer is available only through its capability subpath, not the package root', async () => {
  const root = await import('@socialprune/core');
  const capability =
    await import('@socialprune/core/workspace/instagram-context-writer');
  expect(root).not.toHaveProperty('InstagramContextWriter');
  expect(capability.InstagramContextWriter).toBe(InstagramContextWriter);
});

const controls: [string, (value: WorkspaceV2) => void][] = [
  [
    'comment time 61 seconds off',
    (v) => {
      v.instagramContext![0]!.comment.createdAt = new Date(
        Date.parse(v.items[0]!.createdAt) + 61_000,
      ).toISOString();
    },
  ],
  [
    'owner differs from fixture',
    (v) => {
      v.instagramContext![0]!.post.owner = v.items[0]!.account.handle!;
    },
  ],
  [
    'item has no owner',
    (v) => {
      v.items[0]!.reference.ownerHandle = null;
    },
  ],
  [
    'item has empty text',
    (v) => {
      v.items[0]!.text = '';
    },
  ],
  [
    'attempt is not confirmed',
    (v) => {
      v.browserAttempts![1]!.state = 'unconfirmed';
      v.browserAttempts![1]!.code = 'text';
    },
  ],
  [
    'comment id repeats',
    (v) => {
      const item = structuredClone(v.items[0]!);
      item.id += '2';
      v.items.push(item);
      v.counts.items++;
      const record = {
        ...structuredClone(v.instagramContext![0]!),
        itemId: item.id,
        attemptId: 'second-send',
      };
      v.instagramContext!.push(record);
      v.counts.instagramContext!++;
      v.browserAttempts!.push(
        {
          ...v.browserAttempts![0]!,
          seq: 3,
          itemId: item.id,
          attemptId: 'second-send',
        },
        {
          ...v.browserAttempts![1]!,
          seq: 4,
          itemId: item.id,
          attemptId: 'second-confirmed',
          settles: 'second-send',
        },
      );
      v.counts.browserAttempts! += 2;
    },
  ],
  [
    'confirm-comment in X run',
    (v) => {
      Object.assign(v.browserRuns![0]!, {
        platform: 'x',
        mode: 'fill',
        accountKey: 'x:generated',
      });
    },
  ],
  [
    'delete attempt in Instagram run',
    (v) => {
      v.instagramContext = undefined;
      delete v.counts.instagramContext;
      const item = {
        ...v.items[0]!,
        id: 'x:1',
        platform: 'x',
        account: { key: 'x:generated', handle: 'generated' },
      };
      v.items.push(item);
      v.counts.items++;
      v.browserAttempts = [
        { ...v.browserAttempts![0]!, itemId: item.id, action: 'delete-post' },
      ];
      v.counts.browserAttempts = 1;
    },
  ],
  [
    'ambiguous on confirm-comment',
    (v) => {
      v.browserAttempts![1]!.state = 'ambiguous';
    },
  ],
];
test.each(controls)('RED CONTROL reader rejects %s', async (_name, mutate) => {
  const value = await fixture();
  mutate(value);
  expect(() => validateWorkspace(value)).toThrow();
  await expect(readBackup(chunks(value))).rejects.toThrow();
  const target = createMemoryStore();
  try {
    await expect(
      restoreBackup(target, chunks(value), { batchSize: 1 }),
    ).rejects.toThrow();
  } finally {
    await target.close();
  }
});

test('reader rejects context metadata, file and receipt decoys and every unbacked confirmed settlement', async () => {
  const good = await fixture();
  for (const mutate of [
    (v: WorkspaceV2) => {
      v.instagramContext!.push(structuredClone(v.instagramContext![0]!));
      v.counts.instagramContext!++;
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.image.file = null;
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.screenshot.bytes = null;
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.post.code = '../outside';
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.comment.id = 'not-digits';
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.post.ownerCount = 0;
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.attemptId = 'missing';
    },
    (v: WorkspaceV2) => {
      delete v.instagramContext;
      delete v.counts.instagramContext;
    },
    (v: WorkspaceV2) => {
      v.counts.instagramContext = 2;
    },
    (v: WorkspaceV2) => {
      v.schemaVersion = 4;
    },
    (v: WorkspaceV2) => {
      v.instagramContext![0]!.accountKey = 'instagram:other';
    },
  ]) {
    const value = structuredClone(good);
    mutate(value);
    expect(() => validateWorkspace(value)).toThrow();
    const target = createMemoryStore();
    try {
      await expect(restoreBackup(target, chunks(value))).rejects.toThrow();
    } finally {
      await target.close();
    }
  }
});

test('writer interruption settles failed before the next run, counts steps apart from sends, and cannot write decisions or outcomes', async () => {
  const store = createMemoryStore(),
    writer = new InstagramContextWriter(store),
    item = instagramContractItem(),
    record = instagramContractRecord();
  try {
    await store.write((tx) =>
      tx.items.put({ item, importId: '', metadataImportId: '' }),
    );
    const run = {
      runId: 'interrupted',
      accountKey: item.account.key,
      startedAt: record.confirmedAt,
      planHash: 'd'.repeat(64),
    };
    await writer.startRun(run);
    await writer.sending({
      runId: run.runId,
      attemptId: 'interrupted-send',
      itemId: item.id,
      at: run.startedAt,
    });
    expect((await store.read(readWorkspace)).browserRuns![0]!.pageOpens).toBe(
      0,
    );
    await writer.step(run.runId, run.startedAt);
    await writer.step(run.runId, run.startedAt);
    await writer.startRun({ ...run, runId: 'next' });
    const value = await store.read(readWorkspace);
    expect(value.browserAttempts!.map((a) => [a.state, a.code])).toEqual([
      ['sending', null],
      ['failed', 'INTERRUPTED'],
    ]);
    expect(value.browserRuns![0]).toMatchObject({
      endedAt: run.startedAt,
      endReason: 'error',
      pageOpens: 2,
    });
    expect(value.decisionEvents).toEqual([]);
    expect(value.outcomeEvents).toEqual([]);
    expect(
      Object.getOwnPropertyNames(InstagramContextWriter.prototype).sort(),
    ).toEqual(
      [
        'constructor',
        'startRun',
        'sending',
        'step',
        'settle',
        'confirm',
        'endRun',
        'acceptCanary',
      ].sort(),
    );
    await expect(
      writer.confirm({
        ...record,
        runId: run.runId,
        attemptId: 'interrupted-send',
      }),
    ).rejects.toThrow();
  } finally {
    await store.close();
  }
});

test('confirm refuses invalid records transactionally and repeated sends, and settle enforces result codes', async () => {
  const store = createMemoryStore(),
    writer = new InstagramContextWriter(store),
    item = instagramContractItem(),
    record = instagramContractRecord();
  try {
    await store.write((tx) =>
      tx.items.put({ item, importId: '', metadataImportId: '' }),
    );
    await writer.startRun({
      runId: record.runId,
      accountKey: item.account.key,
      startedAt: record.confirmedAt,
      planHash: 'e'.repeat(64),
    });
    await writer.sending({
      runId: record.runId,
      attemptId: record.attemptId,
      itemId: item.id,
      at: record.confirmedAt,
    });
    await expect(
      writer.sending({
        runId: record.runId,
        attemptId: 'retry',
        itemId: item.id,
        at: record.confirmedAt,
      }),
    ).rejects.toThrow();
    const before = await store.read(readWorkspace);
    await expect(
      writer.confirm({
        ...record,
        post: { ...record.post, owner: item.account.handle! },
      }),
    ).rejects.toThrow();
    expect(await store.read(readWorkspace)).toEqual(before);
    await expect(
      writer.settle({
        attemptId: record.attemptId,
        state: 'not-listed',
        at: record.confirmedAt,
        code: 'wrong',
      }),
    ).rejects.toThrow();
    await writer.settle({
      attemptId: record.attemptId,
      state: 'not-listed',
      at: record.confirmedAt,
      code: 'no-row',
    });
    await expect(writer.confirm(record)).rejects.toThrow();
    expect((await store.read(readWorkspace)).instagramContext).toBeUndefined();
  } finally {
    await store.close();
  }
});

test('version four restores as five without contexts; six refuses explicitly; empty context output is omitted', async () => {
  const old = {
    ...createWorkspace(),
    schemaVersion: 4 as const,
    browserRuns: [],
    browserAttempts: [],
  };
  old.counts = { ...old.counts, browserRuns: 0, browserAttempts: 0 };
  const store = createMemoryStore();
  try {
    await restoreBackup(store, chunks(old));
    expect((await store.read(readWorkspace)).schemaVersion).toBe(5);
    const text: Uint8Array[] = [];
    for await (const chunk of createBackup(store).chunks) text.push(chunk);
    const backup = JSON.parse(
      new TextDecoder().decode(Buffer.concat(text)),
    ) as Record<string, unknown>;
    expect(backup).not.toHaveProperty('instagramContext');
    expect(backup.counts).not.toHaveProperty('instagramContext');
    const six = { ...old, schemaVersion: 6 };
    await expect(readBackup(chunks(six))).rejects.toMatchObject({
      code: 'BACKUP_SCHEMA_UNSUPPORTED',
    });
    const target = createMemoryStore();
    try {
      await expect(restoreBackup(target, chunks(six))).rejects.toMatchObject({
        code: 'BACKUP_SCHEMA_UNSUPPORTED',
      });
    } finally {
      await target.close();
    }
  } finally {
    await store.close();
  }
});

test('context protocol has 1..200 unique Instagram IDs and <=200 records, with no X IDs or arbitrary fields', async () => {
  const record = (await fixture()).instagramContext![0]!,
    input = {
      type: 'getInstagramContext',
      requestId: 'generated',
      itemIds: [record.itemId],
    };
  for (const schema of [
    GetInstagramContextRequestSchema,
    HttpReviewRequestSchema,
    WorkspaceRequestSchema,
  ]) {
    expect(schema.parse(input)).toEqual(input);
    for (const itemIds of [
      [],
      ['x:1'],
      [record.itemId, record.itemId],
      Array.from({ length: 201 }, (_, i) => `instagram:${i}`),
    ])
      expect(schema.safeParse({ ...input, itemIds }).success).toBe(false);
  }
  expect(
    InstagramContextReplySchema.parse({
      type: 'instagramContext',
      requestId: input.requestId,
      records: [record],
    }).records,
  ).toEqual([record]);
  expect(
    InstagramContextReplySchema.safeParse({
      type: 'instagramContext',
      requestId: input.requestId,
      records: Array.from({ length: 201 }, () => record),
    }).success,
  ).toBe(false);
  expect(
    InstagramContextSchema.safeParse({
      ...record,
      url: 'https://example.invalid',
    }).success,
  ).toBe(false);
  expect(
    BrowserRunSchema.safeParse({
      ...(await fixture()).browserRuns![0]!,
      mode: 'delete',
    }).success,
  ).toBe(false);
  expect(
    BrowserAttemptSchema.safeParse({
      ...(await fixture()).browserAttempts![0]!,
      originalId: null,
    }).success,
  ).toBe(false);
});

test('request operation keeps only its bounded name and owner/time checks include the exact 60-second boundary', async () => {
  const input = {
    requestId: 'generated',
    method: 'POST',
    host: 'www.instagram.com',
    path: '/async/wbloks/fetch/',
    status: 200,
  };
  for (const operation of [
    undefined,
    null,
    'Generated_Query_1',
    'a'.repeat(256),
  ])
    expect(
      BrowserRequestSchema.safeParse({
        ...input,
        ...(operation === undefined ? {} : { operation }),
      }).success,
    ).toBe(true);
  for (const operation of [
    '',
    'query-name',
    'query?secret=value',
    'a'.repeat(257),
  ])
    expect(
      BrowserRequestSchema.safeParse({ ...input, operation }).success,
    ).toBe(false);
  const value = await fixture(),
    item = value.items[0]!;
  item.reference.ownerHandle = '@SYNTH_MOSS';
  value.instagramContext![0]!.comment.createdAt = new Date(
    Date.parse(item.createdAt) + 60_000,
  ).toISOString();
  expect(validateWorkspace(value).instagramContext).toEqual(
    value.instagramContext,
  );
  await expect(readBackup(chunks(value))).resolves.toMatchObject({
    instagramContext: value.instagramContext,
  });
});

test('memory rollback removes a settling record when context insertion fails', async () => {
  const item = instagramContractItem(),
    record = instagramContractRecord(),
    base = createWorkspace();
  base.items = [item];
  base.counts.items = 1;
  const original = createMemoryStore(new MemoryStoreBacking(base));
  const writer = new InstagramContextWriter({
    ...original,
    write: (operation) =>
      original.write((tx) =>
        operation({
          ...tx,
          instagramContext: {
            ...tx.instagramContext,
            add: () => Promise.reject(new Error('INJECTED_INSERT_FAILURE')),
          },
        }),
      ),
  });
  try {
    await writer.startRun({
      runId: record.runId,
      accountKey: item.account.key,
      startedAt: record.confirmedAt,
      planHash: 'f'.repeat(64),
    });
    await writer.sending({
      runId: record.runId,
      itemId: item.id,
      attemptId: record.attemptId,
      at: record.confirmedAt,
    });
    const before = await original.read(readWorkspace);
    await expect(writer.confirm(record)).rejects.toThrow(
      'INJECTED_INSERT_FAILURE',
    );
    expect(await original.read(readWorkspace)).toEqual(before);
  } finally {
    await original.close();
  }
});
