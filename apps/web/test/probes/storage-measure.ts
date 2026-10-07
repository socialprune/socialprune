import '@socialprune/core/browser-init';
import {
  IndexedDBStore,
  deleteWorkspaceDatabase,
} from '../../src/workspace/idb-store.ts';
import type { StoredItem } from '@socialprune/core/workspace/store';

export async function measureStorage() {
  const amount = 100_000;
  const id = `measure-${crypto.randomUUID()}`;
  const production = await IndexedDBStore.open(id);
  const now = '2026-01-01T00:00:00.000Z';
  const records: StoredItem[] = Array.from({ length: amount }, (_, index) => ({
    importId: 'generated',
    metadataImportId: 'generated',
    item: {
      id: `x:measurement-${index.toString().padStart(6, '0')}`,
      platform: 'x',
      account: { key: 'invented-measurement', handle: null },
      kind: 'post',
      createdAt: now,
      text: `Invented measurement entry ${index}: literal café URL /insideword/ ${'synthetic text '.repeat(60)}`,
      mediaCount: 0,
      engagement: { likes: index % 17, reposts: null },
      reference: {
        replyToId: null,
        replyToHandle: null,
        quotedId: null,
        repostOfHandle: null,
        ownerHandle: null,
      },
      url: null,
      provenance: { archive: 'generated', file: 'generated.json', index },
    },
  }));
  const start = performance.now();
  for (let offset = 0; offset < amount; offset += 1000)
    await production.putItemBatch(records.slice(offset, offset + 1000));
  const productionMs = performance.now() - start;
  const rawName = `sp-control-${crypto.randomUUID()}`;
  const raw = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(rawName, 1);
    open.onupgradeneeded = () => {
      open.result
        .createObjectStore('items', { keyPath: 'item.id' })
        .createIndex('importId', 'importId');
      open.result.createObjectStore('state', { keyPath: 'itemId' });
      open.result.createObjectStore('imports', { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('Raw control failed.'));
  });
  const rawStart = performance.now();
  for (let offset = 0; offset < amount; offset += 1000)
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction(['items', 'state', 'imports'], 'readwrite');
      for (const record of records.slice(offset, offset + 1000)) {
        tx.objectStore('items').put(record);
        tx.objectStore('state').put({
          itemId: record.item.id,
          decision: 'undecided',
          outcome: 'unknown',
        });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Raw control aborted.'));
    });
  const rawMs = performance.now() - rawStart;
  raw.close();
  const result = {
    count: amount,
    productionMs,
    rawMs,
    slowerPercent: (productionMs / rawMs - 1) * 100,
  };
  await production.close();
  await deleteWorkspaceDatabase(id);
  await new Promise<void>((resolve, reject) => {
    const deleted = indexedDB.deleteDatabase(rawName);
    deleted.onsuccess = () => resolve();
    deleted.onerror = () =>
      reject(deleted.error ?? new Error('Control cleanup failed.'));
  });
  return result;
}
