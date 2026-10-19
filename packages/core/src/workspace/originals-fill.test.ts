import { test, expect } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import { OriginalsFillWriter } from './originals-fill-writer.ts';
import { migrateOriginal } from '../model/original.ts';
import { conversation } from './conversation.ts';
import { readWorkspace } from './store.ts';
import { createBackup, readBackup, restoreBackup } from './backup.ts';
import { validateWorkspace } from './validation.ts';
const at = '2026-10-12T00:00:00.000Z';
function original(id = '910') {
  return migrateOriginal({
    id,
    status: 'fetched',
    fetchedAt: at,
    text: 'Generated beginning',
    authorName: 'Generated',
    authorHandle: 'generated',
    photos: [],
    quotedId: null,
    parentId: null,
    raw: { note_tweet: {} },
    textCompleteness: 'truncated',
    video: null,
  });
}
test('fill writer cannot change decision/outcome state; v4 portable backup preserves completed reads and refuses receipt decoys', async () => {
  const base = contractWorkspace();
  base.originals = [original()];
  base.counts.originals = 1;
  const store = createMemoryStore(new MemoryStoreBacking(base)),
    writer = new OriginalsFillWriter(store);
  try {
    await writer.startRun({
      runId: 'generated-fill',
      accountKey: 'x:contract',
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: at,
    });
    await writer.sending({
      attemptId: 'generated-read',
      runId: 'generated-fill',
      originalId: '910',
      at,
    });
    const record = {
      ...original(),
      text: 'Generated full text',
      textCompleteness: 'full' as const,
      textSource: 'signed-in' as const,
      signedInRecord: { rest_id: '910', text: 'Generated full text' },
      signedIn: {
        status: 'read' as const,
        at,
        runId: 'generated-fill',
        attemptId: 'generated-read',
        reason: null,
      },
    };
    await writer.settle(
      { attemptId: 'generated-read', state: 'read', at, code: null },
      [record],
    );
    await writer.endRun({
      runId: 'generated-fill',
      endedAt: at,
      endReason: 'canary',
      bodyShapes: { 'read-post': ['generated'] },
      profileReport: {
        accountBefore: 'generated',
        accountAfter: 'generated',
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    await writer.acceptCanary('generated-fill', at);
    const value = await store.read(readWorkspace);
    expect(value.decisionEvents).toEqual(base.decisionEvents);
    expect(value.outcomeEvents).toEqual(base.outcomeEvents);
    expect(validateWorkspace(value).originals?.[0]?.text).toBe(
      'Generated full text',
    );
    const backup = createBackup(store, { batchSize: 1 });
    const bytes: Uint8Array[] = [];
    for await (const chunk of backup.chunks) bytes.push(chunk);
    const parsed = await readBackup(
      (async function* () {
        await Promise.resolve();
        yield* bytes;
      })(),
    );
    expect(parsed.schemaVersion).toBe(6);
    expect(parsed.originals).toEqual(value.originals);
    const target = createMemoryStore();
    try {
      await restoreBackup(
        target,
        (async function* () {
          await Promise.resolve();
          yield* bytes;
        })(),
      );
      expect((await target.read(readWorkspace)).originals).toEqual(
        value.originals,
      );
    } finally {
      await target.close();
    }
    for (const defect of [
      {
        ...value,
        originals: [
          { ...value.originals![0]!, signedInRecord: { rest_id: '999' } },
        ],
      },
      {
        ...value,
        originals: [
          { ...value.originals![0]!, signedIn: null, signedInRecord: null },
        ],
      },
      {
        ...value,
        browserAttempts: value.browserAttempts!.map((attempt) =>
          attempt.state === 'read' ? { ...attempt, itemId: 'x:1' } : attempt,
        ),
      },
    ])
      expect(() => validateWorkspace(defect)).toThrow();
    await expect(writer.acceptCanary('generated-fill', at)).rejects.toThrow();
  } finally {
    await store.close();
  }
});
test('interrupted sending becomes failed before another run and a repeated settlement is refused', async () => {
  const base = contractWorkspace();
  base.originals = [original()];
  base.counts.originals = 1;
  const store = createMemoryStore(new MemoryStoreBacking(base)),
    writer = new OriginalsFillWriter(store);
  try {
    await writer.startRun({
      runId: 'run1',
      accountKey: 'x:contract',
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: at,
    });
    await writer.sending({
      attemptId: 'send1',
      runId: 'run1',
      originalId: '910',
      at,
    });
    await writer.startRun({
      runId: 'run2',
      accountKey: 'x:contract',
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: at,
    });
    expect(
      (await store.read(readWorkspace)).browserAttempts?.map(
        (attempt) => attempt.state,
      ),
    ).toEqual(['sending', 'failed']);
    await expect(
      writer.settle(
        { attemptId: 'send1', state: 'failed', at, code: null },
        [],
      ),
    ).rejects.toThrow();
  } finally {
    await store.close();
  }
});
test('conversation joins own items, detects cycles and returns partial at the 20-post ceiling', async () => {
  const base = contractWorkspace();
  base.items[0]!.reference.replyToId = '903';
  const originals = Array.from({ length: 25 }, (_, i) => ({
    ...original(String(900 + i)),
    parentId: i < 24 ? String(901 + i) : null,
  }));
  originals[0]!.parentId = '1';
  base.items[0]!.reference.replyToId = '903';
  base.originals = originals;
  base.counts.originals = 25;
  const store = createMemoryStore(new MemoryStoreBacking(base));
  try {
    const result = await store.read((tx) =>
      conversation(tx, '900', 'x:contract'),
    );
    expect(result.state).toBe('partial');
    expect(result.chain).toHaveLength(20);
    expect(result.chain.some((link) => link.ownItemId === 'x:1')).toBe(true);
    await store.write(async (tx) =>
      tx.originals.put({ ...original('900'), parentId: '900' }),
    );
    expect(
      (await store.read((tx) => conversation(tx, '900', 'x:contract'))).state,
    ).toBe('partial');
  } finally {
    await store.close();
  }
});
test('a planted empty canary cannot promote a later unobserved fill run', async () => {
  const store = createMemoryStore(),
    writer = new OriginalsFillWriter(store);
  try {
    await writer.startRun({
      runId: 'empty-canary',
      accountKey: 'x:contract',
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: at,
    });
    await writer.endRun({
      runId: 'empty-canary',
      endedAt: at,
      endReason: 'canary',
      bodyShapes: {},
      profileReport: {
        accountBefore: null,
        accountAfter: null,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    await expect(writer.acceptCanary('empty-canary', at)).rejects.toThrow(
      'INVALID_CANARY',
    );
  } finally {
    await store.close();
  }
});
