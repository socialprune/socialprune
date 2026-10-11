import { expect, test } from 'vitest';
import { contractWorkspace } from './store-contract.ts';
import { JOURNAL_FIXTURE } from '../model/browser-fixture.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { createBackup, readBackup, restoreBackup } from './backup.ts';
import { readWorkspace } from './store.ts';
import { validateWorkspace } from './validation.ts';

const fixture = () => {
  const base = contractWorkspace();
  return {
    ...base,
    schemaVersion: 3 as const,
    counts: { ...base.counts, ...JOURNAL_FIXTURE.expectedCounts },
    browserRuns: [JOURNAL_FIXTURE.run],
    browserAttempts: JOURNAL_FIXTURE.attempts,
  };
};
const chunks = (text: string) =>
  (async function* () {
    await Promise.resolve();
    for (let i = 0; i < text.length; i += 11) yield text.slice(i, i + 11);
  })();
test('v3 journal round trip preserves unresolved ambiguity with reordered properties and v2 stays readable', async () => {
  const input = fixture();
  expect(validateWorkspace(input)).toEqual(input);
  const source = createMemoryStore(new MemoryStoreBacking(input));
  const target = createMemoryStore();
  try {
    const backup = createBackup(source, { batchSize: 1 });
    let text = '';
    for await (const chunk of backup.chunks)
      text += new TextDecoder().decode(chunk);
    expect((await readBackup(chunks(text))).browserAttempts).toEqual(
      JOURNAL_FIXTURE.attempts,
    );
    const reversed = JSON.stringify(
      Object.fromEntries(
        Object.entries(JSON.parse(text) as Record<string, unknown>).reverse(),
      ),
    );
    await restoreBackup(target, chunks(reversed), { batchSize: 1 });
    const result = await target.read(readWorkspace);
    expect(result.browserAttempts).toEqual(JOURNAL_FIXTURE.attempts);
    expect(result.schemaVersion).toBe(3);
    expect(
      await readBackup(chunks(JSON.stringify(contractWorkspace()))),
    ).toEqual(contractWorkspace());
  } finally {
    await source.close();
    await target.close();
  }
});
test('journal decoys reject broken settlement, duplicate seq, mismatched run/item and older version', async () => {
  const input = fixture();
  for (const change of [
    { ...input, schemaVersion: 2 },
    {
      ...input,
      browserAttempts: [
        { ...JOURNAL_FIXTURE.attempts[0], runId: 'foreign-run' },
        JOURNAL_FIXTURE.attempts[1],
      ],
    },
    {
      ...input,
      browserAttempts: [
        JOURNAL_FIXTURE.attempts[0],
        { ...JOURNAL_FIXTURE.attempts[1], seq: 1 },
      ],
    },
    {
      ...input,
      browserAttempts: [
        JOURNAL_FIXTURE.attempts[0],
        { ...JOURNAL_FIXTURE.attempts[1], settles: 'missing-send' },
      ],
    },
    {
      ...input,
      browserAttempts: [
        JOURNAL_FIXTURE.attempts[0],
        { ...JOURNAL_FIXTURE.attempts[1], itemId: 'x:999' },
      ],
    },
  ]) {
    expect(() => validateWorkspace(change)).toThrow();
    const target = createMemoryStore();
    try {
      await expect(
        restoreBackup(target, chunks(JSON.stringify(change)), { batchSize: 1 }),
      ).rejects.toThrow();
    } finally {
      await target.close();
    }
  }
});

test('writer promotes an old v2 document to v3 without changing its entries or decisions', async () => {
  const old = contractWorkspace(),
    store = createMemoryStore(new MemoryStoreBacking(old));
  try {
    let text = '';
    for await (const chunk of createBackup(store, { batchSize: 1 }).chunks)
      text += new TextDecoder().decode(chunk);
    const result = await readBackup(chunks(text));
    expect(result.schemaVersion).toBe(3);
    expect(result.browserRuns).toEqual([]);
    expect(result.browserAttempts).toEqual([]);
    expect(result.counts).toEqual({
      ...old.counts,
      browserRuns: 0,
      browserAttempts: 0,
    });
    expect(result.items).toEqual(old.items);
    expect(result.decisionEvents).toEqual(old.decisionEvents);
  } finally {
    await store.close();
  }
});

test('v3 reader requires exactly correlated deletion outcome and rejects a planted missing receipt', async () => {
  const base = fixture();
  const attempts = [
    JOURNAL_FIXTURE.attempts[0]!,
    { ...JOURNAL_FIXTURE.attempts[1]!, state: 'deleted' as const },
  ];
  const event = {
    eventId: 'generated-deleted',
    seq: 1,
    itemId: 'x:1',
    value: 'deleted-via-browser' as const,
    previous: 'unknown' as const,
    recordedAt: JOURNAL_FIXTURE.attempts[1]!.at,
    source: { kind: 'human' as const, via: 'browser-x' as const },
    action: {
      id: attempts[1]!.attemptId,
      kind: 'single' as const,
      size: 1,
      reverts: null,
    },
  };
  const input = {
    ...base,
    browserAttempts: attempts,
    outcomeEvents: [event],
    counts: { ...base.counts, outcomeEvents: 1 },
  };
  expect(validateWorkspace(input).outcomeEvents).toEqual([event]);
  for (const broken of [
    {
      ...input,
      outcomeEvents: [],
      counts: { ...input.counts, outcomeEvents: 0 },
    },
    {
      ...input,
      outcomeEvents: [
        { ...event, action: { ...event.action, id: 'missing-receipt' } },
      ],
    },
  ]) {
    expect(() => validateWorkspace(broken)).toThrow();
    const target = createMemoryStore();
    try {
      await expect(
        restoreBackup(target, chunks(JSON.stringify(broken))),
      ).rejects.toThrow();
    } finally {
      await target.close();
    }
  }
});
