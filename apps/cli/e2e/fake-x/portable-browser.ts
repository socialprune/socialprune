import '@socialprune/core/browser-init';
import {
  IndexedDBStore,
  deleteWorkspaceDatabase,
} from '../../../web/src/workspace/idb-store.ts';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { createWorkspace } from '@socialprune/core/workspace/store';

/** Test entry only: a real IndexedDB restore/export, with no platform actions. */
export async function roundTrip(
  text: string,
): Promise<{ text: string; workspace: unknown }> {
  const id = `portable-journal-${crypto.randomUUID()}`;
  const store = await IndexedDBStore.open(id);
  try {
    await restoreBackup(
      store,
      (async function* () {
        await Promise.resolve();
        yield text;
      })(),
      { batchSize: 1 },
    );
    const workspace = await store.read(readWorkspace);
    const backup = createBackup(store, { batchSize: 1 });
    let result = '';
    for await (const chunk of backup.chunks)
      result += new TextDecoder().decode(chunk);
    return { text: result, workspace };
  } finally {
    await store.close();
    await deleteWorkspaceDatabase(id);
  }
}
Object.assign(globalThis, { roundTripJournal: roundTrip });

export async function upgradeDecoy(): Promise<{
  version: number;
  originalPreserved: boolean;
  tables: string[];
}> {
  const id = `upgrade-journal-${crypto.randomUUID()}`,
    name = `sp-ws-${id}`;
  let store = await IndexedDBStore.open(id, createWorkspace({ id }));
  await store.close();
  // Create the exact previous physical layout as a disposable decoy. Copy its
  // metadata and original record back before the additive production upgrade.
  await deleteWorkspaceDatabase(id);
  const opened = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta');
      db.createObjectStore('runtime');
      db.createObjectStore('commands', { keyPath: 'commandId' });
      db.createObjectStore('imports', { keyPath: 'id' });
      db.createObjectStore('items', { keyPath: 'item.id' }).createIndex(
        'importId',
        'importId',
      );
      db.createObjectStore('submissions', { keyPath: 'submissionId' });
      for (const table of ['assessments', 'decisionEvents', 'outcomeEvents']) {
        const log = db.createObjectStore(table, { autoIncrement: true });
        log.createIndex(
          table === 'assessments' ? 'assessmentId' : 'eventId',
          table === 'assessments' ? 'assessmentId' : 'eventId',
          { unique: true },
        );
        log.createIndex('itemId', 'itemId');
      }
      db.createObjectStore('state', { keyPath: 'itemId' });
      db.createObjectStore('eventSequences', { keyPath: 'seq' });
      db.createObjectStore('migrationEvents', { keyPath: 'id' }).createIndex(
        'order',
        ['timestamp', 'kindOrder', 'index'],
      );
      db.createObjectStore('originals', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Upgrade decoy open failed'));
  });
  const {
    counts: unused,
    imports,
    items,
    submissions,
    assessments,
    decisionEvents,
    outcomeEvents,
    ...meta
  } = createWorkspace({ id });
  void unused;
  void imports;
  void items;
  void submissions;
  void assessments;
  void decisionEvents;
  void outcomeEvents;
  const tx = opened.transaction(['meta', 'runtime', 'originals'], 'readwrite');
  tx.objectStore('meta').put(meta, 'workspace');
  tx.objectStore('runtime').put({ revision: 0, lastEventSeq: 0 }, 'runtime');
  tx.objectStore('originals').put({ id: 'decoy-original', generated: true });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error('Upgrade decoy write failed'));
  });
  opened.close();
  try {
    store = await IndexedDBStore.open(id);
    const originalPreserved = Boolean(
      await store.read(async (value) => value.originals.get('decoy-original')),
    );
    await store.close();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Upgrade readback failed'));
    });
    const result = {
      version: raw.version,
      originalPreserved,
      tables: Array.from(raw.objectStoreNames),
    };
    raw.close();
    return result;
  } finally {
    await store.close();
    await deleteWorkspaceDatabase(id);
  }
}
Object.assign(globalThis, { upgradeJournalDecoy: upgradeDecoy });
