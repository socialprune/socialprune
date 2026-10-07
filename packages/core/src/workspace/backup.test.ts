import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import {
  createBackup,
  readBackup,
  restoreBackup,
  applyBackup,
} from './backup.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { readWorkspace } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { validateWorkspace } from './validation.ts';
import { deriveState } from './state.ts';
import { ReviewService } from './review.ts';
import { LabelService } from './labels.ts';
import { contentHash } from './canonical.ts';
import { WorkspaceError } from './errors.ts';

async function fixture() {
  const input: unknown = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/workspace/backup-v2.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  return validateWorkspace(input);
}
async function* chunks(text: string, size = 7): AsyncGenerator<string> {
  await Promise.resolve();
  for (let index = 0; index < text.length; index += size)
    yield text.slice(index, index + size);
}
async function* bytes(text: string): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  for (const byte of new TextEncoder().encode(text)) yield Uint8Array.of(byte);
}
const query = {
  selection: () => Promise.reject(new Error('Query is not used.')),
};

test('hand-written v2 document parses at one-byte boundaries and restores ordered state and history', async () => {
  const input = await fixture();
  const parsed = await readBackup(bytes('\uFEFF' + JSON.stringify(input)));
  expect(parsed).toEqual(input);
  const target = createMemoryStore();
  try {
    await restoreBackup(target, chunks(JSON.stringify(input)), {
      batchSize: 1,
    });
    expect(await target.read(readWorkspace)).toEqual(input);
    expect(
      [...deriveState(await target.read(readWorkspace))].map(([id, value]) => [
        id,
        value.decision,
        value.outcome,
      ]),
    ).toEqual([
      ['x:1', 'keep', 'skipped'],
      ['x:2', 'later', 'unknown'],
    ]);
    const history = await new ReviewService(target, {
      query,
      via: 'web-review',
    }).history();
    expect(
      history.map((entry) => [entry.actionId, entry.kind, entry.value]),
    ).toEqual([
      ['action-5', 'single', 'skipped'],
      ['action-4', 'single', 'deleted-by-user'],
      ['action-3', 'single', 'keep'],
      ['action-2', 'single', 'later'],
      ['action-1', 'single', 'delete'],
    ]);
    expect((await target.read(async (tx) => tx.meta.get())).lastBackupAt).toBe(
      '2026-01-05T00:00:00.000Z',
    );
  } finally {
    await target.close();
  }
});
test('schema property order does not change validation or the unsupported-version code', async () => {
  const input = await fixture();
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  expect(await readBackup(chunks(JSON.stringify(reordered)))).toEqual(input);
  await expect(
    readBackup(chunks(JSON.stringify({ ...reordered, schemaVersion: 99 }))),
  ).rejects.toMatchObject({ code: 'BACKUP_SCHEMA_UNSUPPORTED' });
});
test('writer streams bounded chunks in header order and marks the store only after explicit sink completion', async () => {
  const input = await fixture();
  const source = createMemoryStore(new MemoryStoreBacking(input));
  const createdAt = '2026-02-01T00:00:00.000Z';
  const session = createBackup(source, {
    now: new Date(createdAt),
    chunkBytes: 31,
    batchSize: 1,
  });
  try {
    await expect(session.complete()).rejects.toMatchObject({
      code: 'BACKUP_INCOMPLETE',
    });
    const result: Uint8Array[] = [];
    for await (const chunk of session.chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(31);
      result.push(chunk);
    }
    expect(result.length).toBeGreaterThan(10);
    expect((await source.read(async (tx) => tx.meta.get())).lastBackupAt).toBe(
      input.lastBackupAt,
    );
    const text = new TextDecoder().decode(
      Uint8Array.from(result.flatMap((chunk) => [...chunk])),
    );
    const document: unknown = JSON.parse(text);
    expect(Object.keys(document as object)).toEqual([
      'format',
      'schemaVersion',
      'id',
      'kind',
      'createdAt',
      'updatedAt',
      'lastBackupAt',
      'settings',
      'counts',
      'imports',
      'items',
      'submissions',
      'assessments',
      'decisionEvents',
      'outcomeEvents',
    ]);
    expect(document).toEqual({ ...input, lastBackupAt: createdAt });
    await session.complete();
    await session.complete();
    expect((await source.read(async (tx) => tx.meta.get())).lastBackupAt).toBe(
      createdAt,
    );
  } finally {
    await source.close();
  }
});
test('invariant 7 replays a real label file only as duplicate after the actual streamed restore path', async () => {
  const input = await fixture();
  const source = createMemoryStore(new MemoryStoreBacking(input));
  const target = createMemoryStore();
  try {
    const file = {
      schemaVersion: 1,
      submissionId: 'portable-submission',
      source: { kind: 'agent', name: 'generated-agent', version: '1' },
      labels: [
        {
          itemId: input.items[0]!.id,
          contentHash: await contentHash(input.items[0]!.text),
          category: 'harmless',
          risk: 0,
          reason: 'This generated backup item is a plain statement.',
          evidence: 'not verbatim',
          confidence: null,
        },
      ],
    };
    await new LabelService(source).submitLabels(file);
    const expectedSubmissions = (await source.read(readWorkspace)).submissions;
    const expectedHistory = await new ReviewService(source, {
      query,
      via: 'web-review',
    }).history();
    const session = createBackup(source, {
      now: new Date('2026-02-02T00:00:00.000Z'),
    });
    await restoreBackup(target, session.chunks, { batchSize: 1 });
    await session.complete();
    const restored = await target.read(readWorkspace);
    expect(restored.submissions).toEqual(expectedSubmissions);
    expect([...deriveState(restored)]).toEqual([
      ...deriveState(await source.read(readWorkspace)),
    ]);
    expect(
      await new ReviewService(target, { query, via: 'web-review' }).history(),
    ).toEqual(expectedHistory);
    expect(restored.lastBackupAt).toBe('2026-02-02T00:00:00.000Z');
    const service = new LabelService(target);
    expect(await service.submitLabels(file)).toMatchObject({
      duplicate: true,
      accepted: 1,
    });
    await expect(
      service.submitLabels({
        ...file,
        labels: [{ ...file.labels[0], reason: 'A changed generated reason.' }],
      }),
    ).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' });
    expect((await target.read(readWorkspace)).assessments).toEqual(
      restored.assessments,
    );
    expect((await target.read(readWorkspace)).decisionEvents).toEqual(
      input.decisionEvents,
    );
  } finally {
    await source.close();
    await target.close();
  }
});
test('every malformed, schema, logical, version and aborted staging restore leaves the active store unchanged', async () => {
  const input = await fixture();
  const wrongId = structuredClone(input);
  wrongId.assessments[0]!.itemId = 'x:missing';
  const wrongCount = structuredClone(input);
  wrongCount.counts.items = 3;
  const fixturePersonal = structuredClone(input);
  fixturePersonal.assessments[0]!.source.kind = 'fixture';
  const brokenChain = structuredClone(input);
  brokenChain.decisionEvents[2]!.previous = 'undecided';
  const cases: [string, string][] = [
    ['not json', 'BACKUP_INVALID_JSON'],
    [JSON.stringify(input).slice(0, -5), 'BACKUP_INVALID_JSON'],
    [
      JSON.stringify({ ...input, extra: 'PLANTED_EXTRA' }),
      'BACKUP_INVALID_SCHEMA',
    ],
    [
      JSON.stringify({
        ...input,
        items: [{ ...input.items[0], mediaCount: -1 }],
      }),
      'BACKUP_INVALID_SCHEMA',
    ],
    [JSON.stringify(wrongId), 'UNKNOWN_ITEM'],
    [JSON.stringify(wrongCount), 'COUNT_MISMATCH'],
    [JSON.stringify(fixturePersonal), 'FIXTURE_NOT_ALLOWED'],
    [JSON.stringify(brokenChain), 'EVENT_CHAIN'],
    [
      JSON.stringify({ ...input, schemaVersion: 99 }),
      'BACKUP_SCHEMA_UNSUPPORTED',
    ],
    [
      JSON.stringify(input).replace(
        '"schemaVersion":2',
        '"schemaVersion":2,"schemaVersion":2',
      ),
      'BACKUP_INVALID_SCHEMA',
    ],
  ];
  for (const [text, code] of cases) {
    const active = createMemoryStore(new MemoryStoreBacking(input));
    const target = createMemoryStore();
    let writes = 0;
    const guarded: WorkspaceStore = {
      read: (operation) => target.read(operation),
      write: (operation) => {
        writes++;
        return target.write(operation);
      },
      close: () => target.close(),
    };
    try {
      const before = await active.read(readWorkspace);
      await expect(restoreBackup(guarded, chunks(text))).rejects.toMatchObject({
        code,
        discardTarget: true,
      });
      expect(writes).toBeGreaterThanOrEqual(1);
      expect(await active.read(readWorkspace)).toEqual(before);
    } finally {
      await target.close();
      await active.close();
    }
  }
  const target = createMemoryStore();
  const controller = new AbortController();
  async function* aborted() {
    yield '{"format":"socialprune-workspace",';
    await Promise.resolve();
    controller.abort();
    yield '"schemaVersion":2}';
  }
  try {
    const before = await target.read(readWorkspace);
    await expect(
      restoreBackup(target, aborted(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED', discardTarget: true });
    expect(await target.read(readWorkspace)).toEqual(before);
  } finally {
    await target.close();
  }
});
test('apply rejects a nonempty target and rolls back all writes on storage failure or apply-phase abort', async () => {
  const input = await fixture();
  const nonempty = createMemoryStore(new MemoryStoreBacking(input));
  try {
    await expect(applyBackup(nonempty, input)).rejects.toMatchObject({
      code: 'RESTORE_TARGET_NOT_EMPTY',
    });
    expect(await nonempty.read(readWorkspace)).toEqual(input);
  } finally {
    await nonempty.close();
  }
  for (const mode of ['storage', 'abort']) {
    const target = createMemoryStore();
    const controller = new AbortController();
    const fault: WorkspaceStore = {
      read: (operation) => target.read(operation),
      close: () => target.close(),
      write: (operation) =>
        target.write(async (tx) =>
          operation({
            ...tx,
            items: {
              ...tx.items,
              async put(record) {
                await tx.items.put(record);
                if (mode === 'storage') throw new WorkspaceError('STORAGE');
                controller.abort();
              },
            },
          }),
        ),
    };
    try {
      const before = await target.read(readWorkspace);
      await expect(
        applyBackup(fault, input, { signal: controller.signal, batchSize: 1 }),
      ).rejects.toThrow();
      expect(await target.read(readWorkspace)).toEqual(before);
      expect(await target.read(async (tx) => tx.runtime.get())).toEqual({
        revision: 0,
        lastEventSeq: 0,
      });
    } finally {
      await target.close();
    }
  }
});
test('reader accepts v1 migration and deduplicates identical log records but rejects conflicts', async () => {
  const old = await readFile(
    new URL(
      '../../../../fixtures/synthetic/workspace/v1.json',
      import.meta.url,
    ),
    'utf8',
  );
  expect((await readBackup(chunks(old))).schemaVersion).toBe(2);
  const staged = createMemoryStore();
  try {
    const result = await restoreBackup(staged, chunks(old), { batchSize: 1 });
    expect(result.migratedFrom).toBe(1);
    const migrated = await staged.read(readWorkspace);
    expect(migrated).toEqual(await readBackup(chunks(old)));
    expect(
      migrated.decisionEvents.map((event) => [event.seq, event.value]),
    ).toEqual([
      [1, 'keep'],
      [3, 'delete'],
      [5, 'later'],
    ]);
    expect(
      migrated.outcomeEvents.map((event) => [event.seq, event.value]),
    ).toEqual([
      [2, 'unknown'],
      [4, 'skipped'],
    ]);
    expect(
      [...deriveState(migrated)].map(([id, state]) => [
        id,
        state.decision,
        state.outcome,
      ]),
    ).toEqual([
      ['x:1', 'delete', 'skipped'],
      ['x:2', 'later', 'unknown'],
    ]);
  } finally {
    await staged.close();
  }
  const input = await fixture();
  input.assessments.push(structuredClone(input.assessments[0]!));
  input.counts.assessments++;
  input.decisionEvents.push(structuredClone(input.decisionEvents[0]!));
  input.counts.decisionEvents++;
  const parsed = await readBackup(chunks(JSON.stringify(input)));
  expect(parsed.assessments).toHaveLength(1);
  expect(parsed.decisionEvents).toHaveLength(3);
  expect(parsed.counts.assessments).toBe(1);
  expect(parsed.counts.decisionEvents).toBe(3);
  input.assessments[1]!.reason = 'Conflicting generated reason.';
  await expect(readBackup(chunks(JSON.stringify(input)))).rejects.toMatchObject(
    { code: 'ASSESSMENT_CONFLICT' },
  );
});
test('staging restore rejects duplicate or reversed shared sequences without touching active data', async () => {
  const input = await fixture();
  const duplicate = structuredClone(input);
  duplicate.outcomeEvents[0]!.seq = 3;
  const reversed = structuredClone(input);
  reversed.decisionEvents[1]!.seq = 4;
  reversed.decisionEvents[2]!.seq = 2;
  const invalid = structuredClone(input);
  invalid.decisionEvents[0]!.seq = 0;
  const active = createMemoryStore(new MemoryStoreBacking(input));
  try {
    const before = await active.read(readWorkspace);
    for (const value of [duplicate, reversed, invalid]) {
      const stage = createMemoryStore();
      try {
        await expect(
          restoreBackup(stage, chunks(JSON.stringify(value)), { batchSize: 1 }),
        ).rejects.toMatchObject({ discardTarget: true });
        expect(await active.read(readWorkspace)).toEqual(before);
      } finally {
        await stage.close();
      }
    }
  } finally {
    await active.close();
  }
});
test('late restore rejection reports partially written staging data as discardable, active data unchanged', async () => {
  const input = await fixture();
  const active = createMemoryStore(new MemoryStoreBacking(input));
  const stage = createMemoryStore();
  try {
    const wrongCount = { ...input, counts: { ...input.counts, items: 99 } };
    await expect(
      restoreBackup(stage, chunks(JSON.stringify(wrongCount)), {
        batchSize: 1,
      }),
    ).rejects.toMatchObject({ code: 'COUNT_MISMATCH', discardTarget: true });
    expect((await stage.read(readWorkspace)).items).toHaveLength(2);
    expect(await active.read(readWorkspace)).toEqual(input);
  } finally {
    await active.close();
    await stage.close();
  }
});
test('staging storage rejection and apply-phase abort preserve the separate active store', async () => {
  const input = await fixture();
  const active = createMemoryStore(new MemoryStoreBacking(input));
  try {
    for (const mode of ['storage', 'abort']) {
      const stage = createMemoryStore();
      const controller = new AbortController();
      const fault: WorkspaceStore = {
        read: (operation) => stage.read(operation),
        close: () => stage.close(),
        write: (operation) =>
          stage.write((tx) =>
            operation({
              ...tx,
              items: {
                ...tx.items,
                async put(record) {
                  await tx.items.put(record);
                  if (mode === 'storage') throw new WorkspaceError('STORAGE');
                  controller.abort();
                },
              },
            }),
          ),
      };
      try {
        await expect(
          restoreBackup(fault, chunks(JSON.stringify(input)), {
            signal: controller.signal,
            batchSize: 1,
          }),
        ).rejects.toMatchObject({
          code: mode === 'storage' ? 'STORAGE' : 'CANCELLED',
          discardTarget: true,
        });
        expect(await active.read(readWorkspace)).toEqual(input);
      } finally {
        await stage.close();
      }
    }
  } finally {
    await active.close();
  }
});
test('submission records survive deduplication and differing submission hashes reject', async () => {
  const input = await fixture();
  const source = createMemoryStore(new MemoryStoreBacking(input));
  try {
    await new LabelService(source).submitLabels({
      schemaVersion: 1,
      submissionId: 'dedupe-submission',
      source: { kind: 'agent', name: 'generated-agent', version: null },
      labels: [
        {
          itemId: 'x:1',
          contentHash: await contentHash(input.items[0]!.text),
          category: 'unclear',
          risk: 1,
          reason: 'Generated duplicate submission reason.',
          evidence: null,
          confidence: null,
        },
      ],
    });
    const document = await source.read(readWorkspace);
    document.submissions.push(structuredClone(document.submissions[0]!));
    document.counts.submissions++;
    document.outcomeEvents.push(structuredClone(document.outcomeEvents[0]!));
    document.counts.outcomeEvents++;
    const parsed = await readBackup(chunks(JSON.stringify(document)));
    expect(parsed.submissions).toHaveLength(1);
    expect(parsed.outcomeEvents).toHaveLength(2);
    document.submissions[1]!.contentHash = `sha256:${'0'.repeat(64)}`;
    await expect(
      readBackup(chunks(JSON.stringify(document))),
    ).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' });
  } finally {
    await source.close();
  }
});
test('failed or cancelled backup leaves lastBackupAt and refuses completion; source mutation rejects mixed snapshots', async () => {
  const input = await fixture();
  const source = createMemoryStore(new MemoryStoreBacking(input));
  try {
    const session = createBackup(source, { chunkBytes: 64 });
    for await (const _chunk of session.chunks) {
      void _chunk;
      break;
    }
    await expect(session.complete()).rejects.toMatchObject({
      code: 'BACKUP_INCOMPLETE',
    });
    expect((await source.read(async (tx) => tx.meta.get())).lastBackupAt).toBe(
      input.lastBackupAt,
    );
    const changing = createBackup(source, { chunkBytes: 64 });
    const iterator = changing.chunks[Symbol.asyncIterator]();
    await iterator.next();
    await source.write(async (tx) => {
      await tx.runtime.set({ revision: 1 });
    });
    const consume = async () => {
      while (!(await iterator.next()).done) {
        /* Read until the snapshot guard fails. */
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: 'BACKUP_CHANGED' });
    await expect(changing.complete()).rejects.toMatchObject({
      code: 'BACKUP_INCOMPLETE',
    });
    const controller = new AbortController();
    controller.abort();
    const cancelled = createBackup(source, { signal: controller.signal });
    const consumeCancelled = async () => {
      for await (const _chunk of cancelled.chunks) void _chunk;
    };
    await expect(consumeCancelled()).rejects.toMatchObject({
      name: 'AbortError',
    });
  } finally {
    await source.close();
  }
});
test('portable history matches interleaved human action order with tied timestamps', async () => {
  const initial = await fixture();
  initial.decisionEvents = [];
  initial.outcomeEvents = [];
  initial.counts.decisionEvents = 0;
  initial.counts.outcomeEvents = 0;
  const source = createMemoryStore(new MemoryStoreBacking(initial));
  const target = createMemoryStore();
  let ids = 0;
  const options = {
    query,
    via: 'web-review' as const,
    now: () => new Date('2026-02-01T00:00:00Z'),
    uuid: () => `interleaved-${++ids}`,
  };
  const review = new ReviewService(source, options);
  try {
    await review.decide({
      commandId: 'first',
      itemIds: ['x:1'],
      value: 'delete',
      expected: { 'x:1': 'undecided' },
    });
    await review.outcome({
      commandId: 'second',
      itemIds: ['x:1'],
      value: 'skipped',
      expected: { 'x:1': 'unknown' },
    });
    await review.decide({
      commandId: 'third',
      itemIds: ['x:2'],
      value: 'keep',
      expected: { 'x:2': 'undecided' },
    });
    const expected = await review.history();
    expect(expected.map((entry) => entry.value)).toEqual([
      'keep',
      'skipped',
      'delete',
    ]);
    await restoreBackup(target, createBackup(source).chunks);
    const restored = await new ReviewService(target, options).history();
    expect(restored).toEqual(expected);
    expect(restored.map((entry) => entry.value)).toEqual([
      'keep',
      'skipped',
      'delete',
    ]);
  } finally {
    await source.close();
    await target.close();
  }
});
test('restore applies validated record batches of at most the requested size', async () => {
  const input = await fixture();
  const target = createMemoryStore();
  const sizes: number[] = [];
  const bounded: WorkspaceStore = {
    read: (operation) => target.read(operation),
    close: () => target.close(),
    write: (operation) =>
      target.write((tx) =>
        operation({
          ...tx,
          assessments: {
            ...tx.assessments,
            append(records) {
              sizes.push(records.length);
              return tx.assessments.append(records);
            },
          },
          decisionEvents: {
            ...tx.decisionEvents,
            append(records) {
              sizes.push(records.length);
              return tx.decisionEvents.append(records);
            },
          },
          outcomeEvents: {
            ...tx.outcomeEvents,
            append(records) {
              sizes.push(records.length);
              return tx.outcomeEvents.append(records);
            },
          },
        }),
      ),
  };
  try {
    await restoreBackup(bounded, chunks(JSON.stringify(input)), {
      batchSize: 1,
    });
    expect(sizes).toEqual([1, 1, 1, 1, 1, 1]);
    expect(await target.read(readWorkspace)).toEqual(input);
  } finally {
    await target.close();
  }
});
