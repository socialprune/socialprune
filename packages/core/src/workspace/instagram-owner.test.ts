import { expect, test } from 'vitest';
import {
  InstagramContextSchema,
  validateInstagramContextItem,
  WORKSPACE_SCHEMA_VERSION,
} from '../model/index.ts';
import {
  instagramContractItem,
  instagramContractRecord,
  writeInstagramContextContract,
} from './store-contract.ts';
import { createMemoryStore } from './memory-store.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import {
  createBackup,
  readBackup,
  restoreBackup,
  applyBackup,
} from './backup.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';
import { readFile } from 'node:fs/promises';

test.each([1, 2, 3, 4])(
  'C29 legacy backup v%i restores entries and emits a version 8 portable copy',
  async (version) => {
    const input = JSON.parse(
      await readFile(
        new URL(
          version === 1
            ? '../../../../fixtures/synthetic/workspace/v1.json'
            : '../../../../fixtures/synthetic/workspace/backup-v2.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    input.schemaVersion = version;
    if (version >= 3) {
      input.browserRuns = [];
      input.browserAttempts = [];
      input.counts = {
        ...(input.counts as Record<string, number>),
        browserRuns: 0,
        browserAttempts: 0,
      };
    }
    const target = createMemoryStore();
    try {
      const chunks = async function* () {
        await Promise.resolve();
        yield JSON.stringify(input);
      };
      const parsed = await readBackup(chunks());
      await restoreBackup(target, chunks());
      const current = await target.read(readWorkspace);
      expect(current.schemaVersion).toBe(8);
      expect(current.items).toEqual(parsed.items);
      const portable = await readBackup(createBackup(target).chunks);
      expect(portable.schemaVersion).toBe(8);
      expect(portable.items).toEqual(parsed.items);
    } finally {
      await target.close();
    }
  },
);

test('C29 ownerless post evidence round trips v8 and refuses downgraded evidence or an implicit v8 owner check', async () => {
  const source = createMemoryStore();
  await writeInstagramContextContract(source);
  const value = await source.read(readWorkspace);
  await source.close();
  const item = value.items[0]!;
  item.reference.ownerHandle = null;
  value.instagramContext![0] = {
    ...value.instagramContext![0]!,
    ownerCheck: 'not-in-export',
  };
  const chunks = (input: unknown) =>
    (async function* () {
      await Promise.resolve();
      yield JSON.stringify(input);
    })();
  for (const reversed of [false, true]) {
    const document = reversed
      ? Object.fromEntries(Object.entries(value).reverse())
      : value;
    expect(await readBackup(chunks(document))).toEqual(value);
    const target = createMemoryStore();
    try {
      await restoreBackup(target, chunks(document));
      expect(await target.read(readWorkspace)).toEqual(value);
      const portable = await readBackup(
        createBackup(target, { now: new Date('2026-10-23T00:00:00.000Z') })
          .chunks,
      );
      expect(portable).toEqual({
        ...value,
        lastBackupAt: '2026-10-23T00:00:00.000Z',
      });
    } finally {
      await target.close();
    }
  }
  for (const version of [5, 6, 7, 8]) {
    const planted = structuredClone(value);
    planted.schemaVersion = version;
    if (version === 8)
      Reflect.deleteProperty(planted.instagramContext![0]!, 'ownerCheck');
    if (version < 7) {
      delete planted.reviewPlans;
      delete planted.counts.reviewPlans;
      delete planted.settings.criteria;
      delete planted.settings.keepRules;
    }
    if (version === 5)
      Reflect.deleteProperty(planted.instagramContext![0]!, 'confirmedBy');
    for (const document of [
      planted,
      Object.fromEntries(Object.entries(planted).reverse()),
    ]) {
      await expect(readBackup(chunks(document))).rejects.toThrow();
      const target = createMemoryStore();
      try {
        await expect(restoreBackup(target, chunks(document))).rejects.toThrow();
      } finally {
        await target.close();
      }
    }
  }
  const target = createMemoryStore();
  try {
    await target.write((tx) =>
      tx.items.put({
        item,
        importId: 'generated-c29-import',
        metadataImportId: 'generated-c29-import',
      }),
    );
    const [record] = value.instagramContext ?? [];
    if (!record) throw new Error('Generated context missing');
    const writer = new InstagramContextWriter(target);
    await writer.startRun({
      runId: record.runId,
      accountKey: record.accountKey,
      planHash: 'b'.repeat(64),
      startedAt: record.confirmedAt,
    });
    await writer.sending({
      runId: record.runId,
      attemptId: record.attemptId,
      itemId: item.id,
      at: record.confirmedAt,
    });
    await writer.confirm(record);
    await expect(writer.confirm(record)).rejects.toThrow();
  } finally {
    await target.close();
  }
});

test('C29 model requires an owner check and permits only post evidence when the export has no owner', () => {
  expect(WORKSPACE_SCHEMA_VERSION).toBe(8);
  expect(createWorkspace().schemaVersion).toBe(8);
  const item = instagramContractItem();
  item.reference.ownerHandle = null;
  const record = {
    ...instagramContractRecord(item),
    ownerCheck: 'not-in-export',
  };
  expect(InstagramContextSchema.safeParse(record).success).toBe(true);
  expect(() =>
    validateInstagramContextItem(InstagramContextSchema.parse(record), item),
  ).not.toThrow();
  expect(
    InstagramContextSchema.safeParse({ ...record, ownerCheck: undefined })
      .success,
  ).toBe(false);
  expect(
    InstagramContextSchema.safeParse({
      ...record,
      confirmedBy: 'list',
      comment: { id: null, createdAt: null, expandClicks: 0 },
    }).success,
  ).toBe(false);
  expect(() =>
    validateInstagramContextItem(
      InstagramContextSchema.parse({ ...record, ownerCheck: 'matched-export' }),
      item,
    ),
  ).toThrow();
  const owned = instagramContractItem();
  expect(() =>
    validateInstagramContextItem(InstagramContextSchema.parse(record), owned),
  ).toThrow();
  expect(() =>
    validateInstagramContextItem(
      InstagramContextSchema.parse({
        ...record,
        comment: { ...record.comment, createdAt: '2025-07-31T00:01:01.000Z' },
      }),
      item,
    ),
  ).toThrow();
});
test('C29 v8 requires the owner marker even when its schema version follows all context records', async () => {
  const source = createMemoryStore();
  await writeInstagramContextContract(source);
  const value = await source.read(readWorkspace);
  await source.close();
  Reflect.deleteProperty(value.instagramContext![0]!, 'ownerCheck');
  for (const document of [
    value,
    Object.fromEntries(Object.entries(value).reverse()),
  ]) {
    const chunks = async function* () {
      await Promise.resolve();
      yield JSON.stringify(document);
    };
    await expect(readBackup(chunks())).rejects.toThrow();
    const target = createMemoryStore();
    try {
      await expect(restoreBackup(target, chunks())).rejects.toThrow();
    } finally {
      await target.close();
    }
  }
});

test.each([5, 6, 7, 8])(
  'C29 backup v%i gains or retains explicit matched-export evidence in both readers and restore paths',
  async (version) => {
    const source = createMemoryStore();
    await writeInstagramContextContract(source);
    const value = await source.read(readWorkspace);
    await source.close();
    value.schemaVersion = version;
    if (version < 7) {
      delete value.settings.criteria;
      delete value.settings.keepRules;
      delete value.reviewPlans;
      delete value.counts.reviewPlans;
    }
    for (const record of value.instagramContext!) {
      if (version < 8) Reflect.deleteProperty(record, 'ownerCheck');
      if (version === 5) Reflect.deleteProperty(record, 'confirmedBy');
    }
    for (const input of [
      value,
      Object.fromEntries(Object.entries(value).reverse()),
    ]) {
      const chunks = async function* () {
        await Promise.resolve();
        yield JSON.stringify(input);
      };
      const parsed = await readBackup(chunks());
      expect(parsed.instagramContext![0]).toHaveProperty(
        'ownerCheck',
        'matched-export',
      );
      for (const stream of [false, true]) {
        const target = createMemoryStore();
        try {
          if (stream) await restoreBackup(target, chunks());
          else await applyBackup(target, parsed);
          expect((await target.read(readWorkspace)).schemaVersion).toBe(8);
          const again = await readBackup(createBackup(target).chunks);
          expect(again.instagramContext![0]).toHaveProperty(
            'ownerCheck',
            'matched-export',
          );
        } finally {
          await target.close();
        }
      }
    }
  },
);
