import { expect, test } from 'vitest';
import { contractWorkspace } from './store-contract.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { QueryEngine } from './query.ts';

test('query uses one account, current assessments, exact NFC search and stable default sort', async () => {
  const value = contractWorkspace();
  const first = value.items[0]!;
  value.items = [
    {
      ...first,
      id: 'x:1',
      text: 'CAFÉ generated',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      ...first,
      id: 'x:2',
      text: 'Cafe generated',
      createdAt: '2026-01-02T00:00:00Z',
      engagement: { likes: 0, reposts: null },
    },
    {
      ...first,
      id: 'x:3',
      text: 'Another account',
      account: { key: 'x:other', handle: null },
    },
  ];
  value.counts.items = 3;
  value.assessments = [
    {
      assessmentId: 'old',
      submissionId: null,
      itemId: 'x:1',
      source: { kind: 'rules', name: 'generated', version: null },
      category: 'unclear',
      risk: 3,
      reason: 'Generated previous reason.',
      evidence: null,
      confidence: null,
      createdAt: value.createdAt,
    },
    {
      assessmentId: 'latest',
      submissionId: null,
      itemId: 'x:1',
      source: { kind: 'rules', name: 'generated', version: null },
      category: 'harmless',
      risk: 0,
      reason: 'Generated current reason.',
      evidence: null,
      confidence: null,
      createdAt: value.createdAt,
    },
  ];
  value.counts.assessments = 2;
  const store = createMemoryStore(new MemoryStoreBacking(value));
  try {
    const query = new QueryEngine(store);
    expect(
      await query.query({
        queryId: 'q',
        generation: 1,
        accountKey: 'x:contract',
      }),
    ).toMatchObject({ total: 2 });
    expect(
      query.window('q', 1, 0, 200).map((row) => [row.id, row.highestRisk]),
    ).toEqual([
      ['x:1', 0],
      ['x:2', null],
    ]);
    await query.query({
      queryId: 'q',
      generation: 2,
      accountKey: 'x:contract',
      search: 'cafe\u0301',
    });
    expect(query.window('q', 2, 0, 200).map((row) => row.id)).toEqual(['x:1']);
    await query.query({
      queryId: 'q',
      generation: 3,
      accountKey: 'x:contract',
      search: 'cafe',
    });
    expect(query.window('q', 3, 0, 200).map((row) => row.id)).toEqual(['x:2']);
    await query.query({
      queryId: 'q',
      generation: 4,
      accountKey: 'x:contract',
      filter: { likes: { min: 0, max: 0, unknown: 'exclude' } },
    });
    expect(query.window('q', 4, 0, 200).map((row) => row.id)).toEqual(['x:2']);
    await expect(query.selection('q', 1)).rejects.toMatchObject({
      code: 'QUERY_EXPIRED',
    });
    expect(() => query.window('q', 4, 0, 201)).toThrow('INVALID_QUERY');
  } finally {
    await store.close();
  }
});
test('newer generation cancels a scan at the 5000-item boundary without publishing stale rows', async () => {
  const value = contractWorkspace();
  value.items = Array.from({ length: 10_001 }, (_, index) => ({
    ...value.items[0]!,
    id: `x:${index}`,
  }));
  value.counts.items = value.items.length;
  const store = createMemoryStore(new MemoryStoreBacking(value));
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const firstChunk = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const query = new QueryEngine(store, {
    yieldChunk: () => {
      if (++calls === 1) {
        entered();
        return paused;
      }
      return Promise.resolve();
    },
  });
  try {
    const old = query.query({
      queryId: 'q',
      generation: 1,
      accountKey: 'x:contract',
    });
    const handled = old.catch((error: unknown) => error);
    await firstChunk;
    expect(
      (
        await query.query({
          queryId: 'q',
          generation: 2,
          accountKey: 'x:contract',
          search: 'absent',
        })
      ).total,
    ).toBe(0);
    release();
    expect(await handled).toMatchObject({ code: 'CANCELLED' });
    expect(query.window('q', 2, 0, 200)).toEqual([]);
  } finally {
    release();
    await store.close();
  }
});
test('query vectors expire after ten idle minutes and the fifth result evicts the oldest', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(contractWorkspace()));
  let now = 0;
  const query = new QueryEngine(store, { now: () => now });
  try {
    for (let i = 0; i < 5; i++)
      await query.query({
        queryId: `q-${i}`,
        generation: 1,
        accountKey: 'x:contract',
      });
    await expect(query.selection('q-0', 1)).rejects.toMatchObject({
      code: 'QUERY_EXPIRED',
    });
    expect((await query.selection('q-4', 1)).ids).toEqual(['x:1']);
    now = 10 * 60_000;
    expect(() => query.window('q-4', 1, 0, 200)).toThrow('QUERY_EXPIRED');
  } finally {
    await store.close();
  }
});
