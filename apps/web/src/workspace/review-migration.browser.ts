// Test-only entrypoint imported by the CLI browser proof, never by the app.
import '@socialprune/core/browser-init';
import type { WorkspaceV2 } from '@socialprune/core';
import {
  readWorkspace,
  importForItem,
  initialState,
} from '@socialprune/core/workspace/store';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { IndexedDBStore, deleteWorkspaceDatabase } from './idb-store.ts';

const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error('IndexedDB request failed'));
  });
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });

export async function proveV6Upgrade(legacy: WorkspaceV2) {
  const id = `review-v6-${crypto.randomUUID()}`;
  const opening = indexedDB.open(`sp-ws-${id}`, 6);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('meta');
    db.createObjectStore('runtime');
    for (const [name, keyPath] of [
      ['commands', 'commandId'],
      ['imports', 'id'],
      ['items', 'item.id'],
      ['submissions', 'submissionId'],
      ['state', 'itemId'],
      ['eventSequences', 'seq'],
      ['originals', 'id'],
      ['browserRuns', 'runId'],
      ['browserAttempts', 'attemptId'],
      ['instagramContext', 'itemId'],
      ['migrationEvents', 'id'],
    ] as const) {
      const store = db.createObjectStore(name, { keyPath });
      if (name === 'items') store.createIndex('importId', 'importId');
      if (name === 'browserAttempts') {
        store.createIndex('seq', 'seq', { unique: true });
        store.createIndex('settles', 'settles', { unique: true });
      }
      if (name === 'migrationEvents')
        store.createIndex('order', ['timestamp', 'kindOrder', 'index']);
    }
    for (const name of ['assessments', 'decisionEvents', 'outcomeEvents']) {
      const store = db.createObjectStore(name, { autoIncrement: true });
      store.createIndex(
        name === 'assessments' ? 'assessmentId' : 'eventId',
        name === 'assessments' ? 'assessmentId' : 'eventId',
        { unique: true },
      );
      store.createIndex('itemId', 'itemId');
    }
  };
  const raw = await request(opening);
  const tx = raw.transaction([...raw.objectStoreNames], 'readwrite');
  const finished = done(tx);
  const {
    counts,
    imports,
    items,
    assessments,
    submissions,
    decisionEvents,
    outcomeEvents,
    browserRuns,
    browserAttempts,
    instagramContext,
    originals,
    reviewPlans,
    ...meta
  } = legacy;
  void counts;
  void reviewPlans;
  tx.objectStore('meta').put(meta, 'workspace');
  tx.objectStore('runtime').put({ revision: 0, lastEventSeq: 0 }, 'runtime');
  for (const item of items)
    tx.objectStore('items').add({
      item,
      importId: importForItem(item, imports),
      metadataImportId: importForItem(item, imports),
    });
  for (const state of initialState(legacy)) tx.objectStore('state').add(state);
  for (const [name, values] of Object.entries({
    imports,
    assessments,
    submissions,
    decisionEvents,
    outcomeEvents,
    browserRuns,
    browserAttempts,
    instagramContext,
    originals,
  }))
    for (const value of values ?? []) tx.objectStore(name).add(value);
  await finished;
  raw.close();
  const upgraded = await IndexedDBStore.open(id);
  const first = await upgraded.read(readWorkspace);
  // Context accessor exposes add only; duplicate records must not replace either kind.
  let contextDuplicateRejected = false;
  try {
    await upgraded.write((tx) =>
      tx.instagramContext.add(first.instagramContext![0]!),
    );
  } catch {
    contextDuplicateRejected = true;
  }
  await upgraded.close();
  const reopened = await IndexedDBStore.open(id);
  const second = await reopened.read(readWorkspace);
  await reopened.close();
  const version = await request(indexedDB.open(`sp-ws-${id}`));
  const physical = {
    version: version.version,
    plans: version.objectStoreNames.contains('reviewPlans'),
  };
  version.close();
  await deleteWorkspaceDatabase(id);
  return { first, second, physical, contextDuplicateRejected };
}

export async function browserRoundTrip(text: string) {
  const id = `review-restore-${crypto.randomUUID()}`;
  const store = await IndexedDBStore.open(id);
  try {
    await restoreBackup(
      store,
      (async function* () {
        await Promise.resolve();
        yield text;
      })(),
    );
    const workspace = await store.read(readWorkspace);
    let output = '';
    for await (const chunk of createBackup(store, {
      now: new Date('2026-10-21T00:00:00.000Z'),
    }).chunks)
      output += new TextDecoder().decode(chunk);
    return { workspace, output };
  } finally {
    await store.close();
    await deleteWorkspaceDatabase(id);
  }
}
