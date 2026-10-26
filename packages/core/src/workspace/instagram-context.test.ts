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
import { JOURNAL_FIXTURE } from '../model/browser-fixture.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { createWorkspace, readWorkspace, records } from './store.ts';
import {
  instagramContractItem,
  instagramContractRecord,
  writeInstagramContextContract,
} from './store-contract.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';
import {
  applyBackup,
  createBackup,
  readBackup,
  restoreBackup,
} from './backup.ts';
import { validateWorkspace } from './validation.ts';
import { migrateReviewContract } from '../criteria/migration.ts';
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

function withoutReviewV7(value: {
  settings: unknown;
  counts?: unknown;
  reviewPlans?: unknown;
  submissions?: unknown;
}): void {
  delete value.reviewPlans;
  if (value.counts)
    delete (value.counts as Record<string, unknown>).reviewPlans;
  const settings = value.settings as Record<string, unknown>;
  delete settings.criteria;
  delete settings.keepRules;
  if (settings.review) delete (settings.review as Record<string, unknown>).feed;
  for (const submission of (value.submissions ?? []) as Record<
    string,
    unknown
  >[])
    delete submission.criteria;
}

test.each([2, 3] as const)(
  'C10 revision v%i restore and apply write current metadata without changing existing data',
  async (version) => {
    const legacy = JSON.parse(
      await readFile(
        new URL(
          '../../../../fixtures/synthetic/workspace/backup-v2.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as WorkspaceV2;
    legacy.schemaVersion = version;
    if (version === 3) {
      legacy.browserRuns = [
        { ...JOURNAL_FIXTURE.run, accountKey: legacy.items[0]!.account.key },
      ];
      legacy.browserAttempts = JOURNAL_FIXTURE.attempts.map((attempt) => ({
        ...attempt,
        itemId: legacy.items[0]!.id,
      }));
      legacy.counts.browserRuns = 1;
      legacy.counts.browserAttempts = 2;
    }
    expect(await readBackup(chunks(legacy))).toEqual(legacy);
    for (const method of ['apply', 'stream'] as const) {
      const store = createMemoryStore();
      try {
        if (method === 'apply') await applyBackup(store, legacy);
        else await restoreBackup(store, chunks(legacy));
        const restored = await store.read(readWorkspace);
        expect(validateWorkspace(restored)).toEqual({
          ...migrateReviewContract(legacy),
          schemaVersion: 11,
        });
      } finally {
        await store.close();
      }
    }
  },
);

test('C10 v5 context backups gain post confirmation in both readers and streaming restore, including reversed keys', async () => {
  const current = await fixture();
  const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  legacy.schemaVersion = 5;
  withoutReviewV7(legacy as { settings: unknown });
  delete legacy.reviewPlans;
  delete (legacy.counts as Record<string, unknown>).reviewPlans;
  for (const record of legacy.instagramContext as Record<string, unknown>[])
    delete record.confirmedBy;
  for (const input of [
    legacy,
    Object.fromEntries(Object.entries(legacy).reverse()),
  ]) {
    expect(validateWorkspace(input).instagramContext![0]).toHaveProperty(
      'confirmedBy',
      'post',
    );
    expect(
      (await readBackup(chunks(input))).instagramContext![0],
    ).toHaveProperty('confirmedBy', 'post');
    const target = createMemoryStore();
    try {
      await restoreBackup(target, chunks(input), { batchSize: 1 });
      const restored = await target.read(readWorkspace);
      expect(restored.schemaVersion).toBe(11);
      expect(restored.instagramContext![0]).toHaveProperty(
        'confirmedBy',
        'post',
      );
    } finally {
      await target.close();
    }
  }
});

test('C10 list confirmation permits null comment identity in both readers and preserves it through backup', async () => {
  const value = await fixture();
  Object.assign(value, { schemaVersion: 6 });
  withoutReviewV7(value);
  delete value.reviewPlans;
  delete value.counts.reviewPlans;
  Object.assign(value.instagramContext![0]!, { confirmedBy: 'list' });
  Object.assign(value.instagramContext![0]!.comment, {
    id: null,
    createdAt: null,
  });
  expect(validateWorkspace(value)).toEqual(value);
  expect(await readBackup(chunks(value))).toEqual(value);
  const target = createMemoryStore();
  try {
    await restoreBackup(target, chunks(value));
    const backup = createBackup(target);
    let text = '';
    for await (const chunk of backup.chunks)
      text += new TextDecoder().decode(chunk);
    await backup.complete();
    expect(
      (await readBackup(chunks(JSON.parse(text)))).instagramContext,
    ).toEqual(value.instagramContext);
  } finally {
    await target.close();
  }
});

test('C10 a parsed v5 backup composes with validate and apply at the current version', async () => {
  const input = JSON.parse(JSON.stringify(await fixture())) as Record<
    string,
    unknown
  >;
  input.schemaVersion = 5;
  withoutReviewV7(input as { settings: unknown });
  for (const record of input.instagramContext as Record<string, unknown>[])
    delete record.confirmedBy;
  const parsed = await readBackup(chunks(input));
  expect(validateWorkspace(parsed)).toEqual(parsed);
  expect(parsed.schemaVersion).toBe(6);
  const target = createMemoryStore();
  try {
    await applyBackup(target, parsed);
    expect((await target.read(readWorkspace)).instagramContext).toEqual(
      parsed.instagramContext,
    );
  } finally {
    await target.close();
  }
});

test('C10 v5 cannot carry version-six confirmation fields even when its header comes last', async () => {
  const current = await fixture();
  for (const confirmedBy of ['post', 'list']) {
    const invalid = structuredClone(current);
    Object.assign(invalid, { schemaVersion: 5 });
    withoutReviewV7(invalid);
    Object.assign(invalid.instagramContext![0]!, { confirmedBy });
    if (confirmedBy === 'list')
      Object.assign(invalid.instagramContext![0]!.comment, {
        id: null,
        createdAt: null,
      });
    for (const input of [
      invalid,
      Object.fromEntries(Object.entries(invalid).reverse()),
    ]) {
      expect(() => validateWorkspace(input)).toThrow();
      await expect(readBackup(chunks(input))).rejects.toThrow();
      const target = createMemoryStore();
      try {
        await expect(restoreBackup(target, chunks(input))).rejects.toThrow();
      } finally {
        await target.close();
      }
    }
  }
});

test.each(['list-id', 'list-time', 'post-id', 'post-time', 'missing-kind'])(
  'C10 readers refuse inconsistent confirmation identity %s',
  async (mode) => {
    const value = await fixture();
    Object.assign(value, { schemaVersion: 6 });
    withoutReviewV7(value);
    const record = value.instagramContext![0]!;
    Object.assign(record, {
      confirmedBy: mode.startsWith('list') ? 'list' : 'post',
    });
    if (mode.startsWith('list'))
      Object.assign(record.comment, { id: null, createdAt: null });
    if (mode === 'list-id') record.comment.id = '123';
    if (mode === 'list-time')
      record.comment.createdAt = value.items[0]!.createdAt;
    if (mode === 'post-id') Object.assign(record.comment, { id: null });
    if (mode === 'post-time')
      Object.assign(record.comment, { createdAt: null });
    if (mode === 'missing-kind') Reflect.deleteProperty(record, 'confirmedBy');
    expect(() => validateWorkspace(value)).toThrow();
    await expect(readBackup(chunks(value))).rejects.toThrow();
    const target = createMemoryStore();
    try {
      await expect(restoreBackup(target, chunks(value))).rejects.toThrow();
    } finally {
      await target.close();
    }
    const reversedTarget = createMemoryStore();
    try {
      await expect(
        restoreBackup(
          reversedTarget,
          chunks(Object.fromEntries(Object.entries(value).reverse())),
        ),
      ).rejects.toThrow();
    } finally {
      await reversedTarget.close();
    }
  },
);

test('C10 two list records with null ids are accepted while two set comment ids remain refused', async () => {
  const value = await fixture();
  Object.assign(value, { schemaVersion: 6 });
  withoutReviewV7(value);
  const item = structuredClone(value.items[0]!);
  item.id += '-list-second';
  const first = value.instagramContext![0]!;
  Object.assign(first, { confirmedBy: 'list' });
  Object.assign(first.comment, { id: null, createdAt: null });
  const second = {
    ...structuredClone(first),
    itemId: item.id,
    attemptId: first.attemptId + '-second',
  };
  value.items.push(item);
  value.counts.items++;
  value.instagramContext!.push(second);
  value.counts.instagramContext!++;
  const send = value.browserAttempts!.find(
    (attempt) => attempt.attemptId === first.attemptId,
  )!;
  const settle = value.browserAttempts!.find(
    (attempt) => attempt.settles === first.attemptId,
  )!;
  value.browserAttempts!.push(
    { ...send, seq: 3, attemptId: second.attemptId, itemId: item.id },
    {
      ...settle,
      seq: 4,
      attemptId: settle.attemptId + '-second',
      settles: second.attemptId,
      itemId: item.id,
    },
  );
  value.counts.browserAttempts! += 2;
  expect(validateWorkspace(value)).toEqual(value);
  expect(await readBackup(chunks(value))).toEqual(value);
  for (const record of value.instagramContext!) {
    Object.assign(record, { confirmedBy: 'post' });
    Object.assign(record.comment, { id: '123', createdAt: item.createdAt });
  }
  expect(() => validateWorkspace(value)).toThrow();
  await expect(readBackup(chunks(value))).rejects.toThrow();
});

test('C10 readers accept version six and refuse later headers as unsupported', async () => {
  const value = await fixture();
  Object.assign(value, { schemaVersion: 6 });
  withoutReviewV7(value);
  delete value.reviewPlans;
  delete value.counts.reviewPlans;
  expect((await readBackup(chunks(value))).schemaVersion).toBe(6);
  const target = createMemoryStore();
  try {
    await restoreBackup(target, chunks(value));
    expect((await target.read(readWorkspace)).schemaVersion).toBe(11);
  } finally {
    await target.close();
  }
  const later = { ...value, schemaVersion: 12 };
  await expect(readBackup(chunks(later))).rejects.toMatchObject({
    code: 'BACKUP_SCHEMA_UNSUPPORTED',
  });
  const refused = createMemoryStore();
  try {
    const before = await refused.read(readWorkspace);
    await expect(restoreBackup(refused, chunks(later))).rejects.toMatchObject({
      code: 'BACKUP_SCHEMA_UNSUPPORTED',
    });
    expect(await refused.read(readWorkspace)).toEqual(before);
  } finally {
    await refused.close();
  }
});

test('C10 writer stores two list confirmations with null ids without treating null as a duplicate', async () => {
  const store = createMemoryStore();
  const value = await fixture();
  const firstItem = {
    ...instagramContractItem(),
    id: 'instagram:generated-list-first',
  };
  const second = { ...firstItem, id: firstItem.id + '-second' };
  const record = instagramContractRecord(firstItem);
  value.items.push(firstItem, second);
  value.counts.items += 2;
  const writer = new InstagramContextWriter(store);
  const at = record.confirmedAt;
  try {
    await store.write(async (tx) => {
      for (const item of value.items)
        await tx.items.put({ item, importId: '', metadataImportId: '' });
    });
    await writer.startRun({
      runId: record.runId,
      accountKey: record.accountKey,
      planHash: 'a'.repeat(64),
      startedAt: at,
    });
    for (const [index, item] of [firstItem, second].entries()) {
      const attemptId = `generated-list-${index}`;
      await writer.sending({
        runId: record.runId,
        itemId: item.id,
        attemptId,
        at,
      });
      await writer.confirm({
        ...record,
        itemId: item.id,
        attemptId,
        confirmedBy: 'list',
        comment: { id: null, createdAt: null, expandClicks: 10 },
      });
    }
    const saved = await store.read((tx) => records(tx.instagramContext));
    expect(saved).toHaveLength(2);
    expect(
      saved.every(
        (record) => record.confirmedBy === 'list' && record.comment.id === null,
      ),
    ).toBe(true);
  } finally {
    await store.close();
  }
});
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
  withoutReviewV7(value);
  delete value.reviewPlans;
  delete value.counts.reviewPlans;
  const expected = structuredClone(value);
  Object.assign(expected, { schemaVersion: 6 });
  for (const record of value.instagramContext!)
    Reflect.deleteProperty(record, 'confirmedBy');
  expect(validateWorkspace(value)).toEqual(expected);
});

test('literal schema 5 remains readable through readBackup after the writer version advances', async () => {
  const value = { ...(await fixture()), schemaVersion: 5 as const };
  withoutReviewV7(value);
  delete value.reviewPlans;
  delete value.counts.reviewPlans;
  const expected = structuredClone(value);
  Object.assign(expected, { schemaVersion: 6 });
  for (const record of value.instagramContext!)
    Reflect.deleteProperty(record, 'confirmedBy');
  expect(await readBackup(chunks(value))).toEqual(expected);
});

test('literal schema 5 remains readable through streaming restoreBackup after the writer version advances', async () => {
  const value = { ...(await fixture()), schemaVersion: 5 as const };
  withoutReviewV7(value);
  delete value.reviewPlans;
  delete value.counts.reviewPlans;
  const expected = structuredClone(value.instagramContext);
  for (const record of value.instagramContext!)
    Reflect.deleteProperty(record, 'confirmedBy');
  for (const document of [
    value,
    Object.fromEntries(Object.entries(value).reverse()),
  ]) {
    const target = createMemoryStore();
    try {
      await restoreBackup(target, chunks(document), { batchSize: 1 });
      expect((await target.read(readWorkspace)).instagramContext).toEqual(
        expected,
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
        'fillLikes',
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

test('version four restores as ten without contexts; eleven refuses explicitly; empty context output is omitted', async () => {
  const old = {
    ...createWorkspace(),
    schemaVersion: 4 as const,
    browserRuns: [],
    browserAttempts: [],
  };
  old.counts = { ...old.counts, browserRuns: 0, browserAttempts: 0 };
  withoutReviewV7(old);
  delete old.reviewPlans;
  delete old.counts.reviewPlans;
  const store = createMemoryStore();
  try {
    await restoreBackup(store, chunks(old));
    expect((await store.read(readWorkspace)).schemaVersion).toBe(11);
    const text: Uint8Array[] = [];
    for await (const chunk of createBackup(store).chunks) text.push(chunk);
    const backup = JSON.parse(
      new TextDecoder().decode(Buffer.concat(text)),
    ) as Record<string, unknown>;
    expect(backup).not.toHaveProperty('instagramContext');
    expect(backup.counts).not.toHaveProperty('instagramContext');
    const future = { ...old, schemaVersion: 12 };
    await expect(readBackup(chunks(future))).rejects.toMatchObject({
      code: 'BACKUP_SCHEMA_UNSUPPORTED',
    });
    const target = createMemoryStore();
    try {
      await expect(restoreBackup(target, chunks(future))).rejects.toMatchObject(
        {
          code: 'BACKUP_SCHEMA_UNSUPPORTED',
        },
      );
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
      mode: 'fill',
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

async function canaryFixture(
  confirmed = 5,
  skipped = 10,
  extra = 0,
  skipCode = 'not-shown',
) {
  const store = createMemoryStore(),
    writer = new InstagramContextWriter(store),
    base = instagramContractItem(),
    record = instagramContractRecord(),
    at = record.confirmedAt;
  await writer.startRun({
    runId: record.runId,
    accountKey: base.account.key,
    startedAt: at,
    planHash: 'c'.repeat(64),
    canary: true,
  });
  const checked: string[] = [];
  for (let index = 0; index < confirmed + skipped + extra; index++) {
    const item = { ...base, id: `${base.id}-${index}` },
      attemptId = `generated-canary-${index}`;
    await store.write((tx) =>
      tx.items.put({ item, importId: '', metadataImportId: '' }),
    );
    await writer.sending({
      runId: record.runId,
      itemId: item.id,
      attemptId,
      at,
    });
    if (index < skipped)
      await writer.settle({
        attemptId,
        state:
          skipCode === 'not-listed'
            ? 'not-listed'
            : skipCode === 'unavailable' ||
                (skipCode === 'not-shown' && index % 2)
              ? 'unavailable'
              : 'unconfirmed',
        code:
          skipCode === 'not-listed'
            ? 'no-row'
            : skipCode === 'unavailable' ||
                (skipCode === 'not-shown' && index % 2)
              ? null
              : skipCode,
        at,
      });
    else if (index < skipped + confirmed) {
      await writer.confirm({
        ...record,
        itemId: item.id,
        attemptId,
        comment: { ...record.comment, id: String(910001 + index) },
      });
      checked.push(item.id);
    }
  }
  // An injected unfinished run tests acceptCanary itself, not endRun's guard.
  await store.write(async (tx) => {
    const run = (await tx.browserRuns.get(record.runId))!;
    await tx.browserRuns.put({ ...run, endedAt: at, endReason: 'canary' });
  });
  return { store, writer, record, at, checked };
}

test('C8 writer accepts exactly five checked confirmations after ten IG-6 skips', async () => {
  const h = await canaryFixture();
  try {
    await h.writer.acceptCanary(h.record.runId, h.at, h.checked);
    expect(
      await h.store.read((tx) => tx.browserRuns.get(h.record.runId)),
    ).toMatchObject({ canaryAcceptedAt: h.at });
  } finally {
    await h.store.close();
  }
});

test.each([
  'owner',
  'time',
  'text',
  'several',
  'not-listed',
  'not-shown',
  'unavailable',
])('C9 writer accepts five checked records after skipped %s', async (code) => {
  const h = await canaryFixture(5, 10, 0, code);
  try {
    await h.writer.acceptCanary(h.record.runId, h.at, h.checked);
    expect(
      await h.store.read((tx) => tx.browserRuns.get(h.record.runId)),
    ).toMatchObject({ canaryAcceptedAt: h.at });
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(5);
  } finally {
    await h.store.close();
  }
});

test.each([
  ['four confirmations', 4, 11, 0],
  ['sixteen sends', 5, 11, 0],
  ['unsettled sending', 5, 9, 1],
  ['short automatic sample', 4, 0, 0],
] as const)(
  'C8 writer refuses %s without acceptance',
  async (_name, confirmed, skipped, extra) => {
    const h = await canaryFixture(confirmed, skipped, extra);
    try {
      await expect(
        h.writer.acceptCanary(h.record.runId, h.at, h.checked),
      ).rejects.toThrow('INVALID_CANARY');
      expect(
        await h.store.read((tx) => tx.browserRuns.get(h.record.runId)),
      ).toMatchObject({ canaryAcceptedAt: null });
    } finally {
      await h.store.close();
    }
  },
);

test.each([
  'owner',
  'time',
  'text',
  'several',
  'failed',
  'ambiguous',
  'missing-record',
  'missing-check',
  'duplicate-check',
] as const)(
  'C8 writer refuses a planted %s at the acceptance boundary',
  async (mode) => {
    const h = await canaryFixture(5, 0);
    const source = h.store;
    const writer = new InstagramContextWriter({
      ...source,
      write: (operation) =>
        source.write((tx) =>
          operation({
            ...tx,
            instagramContext: {
              ...tx.instagramContext,
              get: (id) =>
                mode === 'missing-record' && id === h.checked[0]
                  ? Promise.resolve(undefined)
                  : tx.instagramContext.get(id),
            },
            browserAttempts: {
              ...tx.browserAttempts,
              async *iterate() {
                for await (const attempt of tx.browserAttempts.iterate())
                  yield attempt.state === 'confirmed' &&
                  attempt.itemId === h.checked[0] &&
                  !mode.endsWith('record') &&
                  !mode.endsWith('check')
                    ? {
                        ...attempt,
                        state:
                          mode === 'failed' || mode === 'ambiguous'
                            ? mode
                            : 'unconfirmed',
                        code: mode,
                      }
                    : attempt;
              },
            },
          }),
        ),
    });
    try {
      const checked =
        mode === 'missing-check'
          ? h.checked.slice(1)
          : mode === 'duplicate-check'
            ? h.checked.map(() => h.checked[0]!)
            : h.checked;
      await expect(
        writer.acceptCanary(h.record.runId, h.at, checked),
      ).rejects.toThrow('INVALID_CANARY');
      expect(
        await source.read((tx) => tx.browserRuns.get(h.record.runId)),
      ).toMatchObject({ canaryAcceptedAt: null });
    } finally {
      await source.close();
    }
  },
);

test.each(['failed', 'ambiguous'] as const)(
  'C9 writer refuses skipped state %s with five other checked confirmations',
  async (mode) => {
    const h = await canaryFixture();
    const writer = new InstagramContextWriter({
      ...h.store,
      write: (operation) =>
        h.store.write((tx) =>
          operation({
            ...tx,
            browserAttempts: {
              ...tx.browserAttempts,
              async *iterate() {
                for await (const attempt of tx.browserAttempts.iterate())
                  yield attempt.settles === 'generated-canary-0'
                    ? {
                        ...attempt,
                        state:
                          mode === 'failed' || mode === 'ambiguous'
                            ? mode
                            : 'unconfirmed',
                        code: mode,
                      }
                    : attempt;
              },
            },
          }),
        ),
    });
    try {
      await expect(
        writer.acceptCanary(h.record.runId, h.at, h.checked),
      ).rejects.toThrow('INVALID_CANARY');
      expect(
        await h.store.read((tx) => tx.browserRuns.get(h.record.runId)),
      ).toMatchObject({ canaryAcceptedAt: null });
    } finally {
      await h.store.close();
    }
  },
);
test('C8 writer refuses manual acceptance at fifteen attempts without five confirmations', async () => {
  const h = await canaryFixture(4, 11);
  try {
    await expect(h.writer.acceptCanary(h.record.runId, h.at)).rejects.toThrow(
      'INVALID_CANARY',
    );
    expect(
      await h.store.read((tx) => tx.browserRuns.get(h.record.runId)),
    ).toMatchObject({ canaryAcceptedAt: null });
  } finally {
    await h.store.close();
  }
});
