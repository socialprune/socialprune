import { expect, test } from 'vitest';
import { createBackup, readBackup, restoreBackup } from './backup.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import type { IterationOptions, WorkspaceStore } from './store.ts';
import { iterationBounds } from './store.ts';

test('20000-item backup is generated and parsed in bounded chunks with measured heap', async () => {
  const count = 20_000;
  const fixture = contractWorkspace();
  const template = fixture.items[0]!;
  fixture.items = [];
  fixture.counts.items = 0;
  const base = createMemoryStore(new MemoryStoreBacking(fixture));
  let producedRecords = 0;
  const item = (index: number) => ({
    item: {
      ...template,
      id: `x:${index}`,
      text: `Generated backup item ${index} ä😺.`,
    },
    importId: '',
    metadataImportId: '',
  });
  const lazy: WorkspaceStore = {
    read: (operation) =>
      base.read((tx) =>
        operation({
          ...tx,
          items: {
            get(id) {
              const index = Number(id.slice(2));
              return Promise.resolve(
                index >= 0 && index < count ? item(index) : undefined,
              );
            },
            async *iterate(options: IterationOptions = {}) {
              await Promise.resolve();
              const { offset, limit } = iterationBounds(options);
              for (
                let index = offset;
                index < count && index < offset + limit;
                index++
              ) {
                producedRecords++;
                yield item(index);
              }
            },
          },
        }),
      ),
    write: (operation) => base.write(operation),
    close: () => base.close(),
  };
  let chunks = 0,
    byteCount = 0,
    largest = 0;
  const startHeap = process.memoryUsage().heapUsed;
  let peakHeap = startHeap;
  const session = createBackup(lazy, {
    chunkBytes: 4096,
    batchSize: 1,
    now: new Date('2026-04-01T00:00:00Z'),
  });
  async function* measured() {
    for await (const chunk of session.chunks) {
      chunks++;
      byteCount += chunk.byteLength;
      largest = Math.max(largest, chunk.byteLength);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      yield chunk;
    }
  }
  try {
    const parsed = await readBackup(measured());
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    expect(parsed.items).toHaveLength(count);
    expect(parsed.items[0]?.text).toBe('Generated backup item 0 ä😺.');
    expect(parsed.items.at(-1)?.id).toBe('x:19999');
    expect(parsed.counts.items).toBe(count);
    expect(parsed.lastBackupAt).toBe('2026-04-01T00:00:00.000Z');
    expect(chunks).toBeGreaterThan(1000);
    expect(largest).toBeLessThanOrEqual(4096);
    expect(producedRecords).toBe(count * 2);
    const target = createMemoryStore();
    try {
      const streamed = createBackup(lazy, { chunkBytes: 4096, batchSize: 1 });
      const result = await restoreBackup(target, streamed.chunks, {
        batchSize: 256,
      });
      expect(result.counts.items).toBe(count);
      expect(result.lastEventSeq).toBe(0);
      expect(
        (await target.read(async (tx) => tx.items.get('x:19999')))?.item.text,
      ).toBe('Generated backup item 19999 ä😺.');
    } finally {
      await target.close();
    }
    console.info(
      JSON.stringify({
        test: 'backup-scale',
        items: count,
        byteCount,
        chunks,
        largest,
        startHeapBytes: startHeap,
        peakHeapBytes: peakHeap,
        peakHeapMiB: peakHeap / 1024 ** 2,
      }),
    );
  } finally {
    await base.close();
  }
}, 60_000);
