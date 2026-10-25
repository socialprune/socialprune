// Test-only migration entrypoint. It is never imported by the application.
import '@socialprune/core/browser-init';
import type { WorkspaceV2 } from '@socialprune/core';
import {
  readWorkspace,
  importForItem,
  initialState,
} from '@socialprune/core/workspace/store';
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
export async function proveOwnerUpgrade(
  legacy: WorkspaceV2,
  fail: boolean,
  legacyVersion: 7 | 8 = 7,
) {
  const id = `owner-v${legacyVersion}-${crypto.randomUUID()}`;
  const opening = indexedDB.open(`sp-ws-${id}`, legacyVersion);
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
      ['reviewPlans', 'actionId'],
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
      const key = name === 'assessments' ? 'assessmentId' : 'eventId';
      store.createIndex(key, key, { unique: true });
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
    reviewPlans,
  }))
    for (const value of values ?? []) tx.objectStore(name).add(value);
  await finished;
  raw.close();
  let upgraded: IndexedDBStore | undefined;
  const descriptor = Object.getOwnPropertyDescriptor(
    IDBObjectStore.prototype,
    'put',
  );
  if (fail && legacyVersion === 8) {
    if (!descriptor) throw new Error('Test metadata write descriptor missing');
    const original = descriptor.value as IDBObjectStore['put'];
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      ...descriptor,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'meta' && key === 'workspace')
          throw new Error('Generated v9 metadata write failure');
        return original.call(this, value, key);
      },
    });
  }
  try {
    let rejected = false;
    try {
      upgraded = await IndexedDBStore.open(id);
    } catch {
      rejected = true;
    }
    if (descriptor && fail && legacyVersion === 8)
      Object.defineProperty(IDBObjectStore.prototype, 'put', descriptor);
    if (fail) {
      await upgraded?.close();
      upgraded = undefined;
      const check = await request(indexedDB.open(`sp-ws-${id}`));
      try {
        const reading = check.transaction(
          ['meta', 'instagramContext'],
          'readonly',
        );
        const oldMeta = (await request(
          reading.objectStore('meta').get('workspace'),
        )) as { schemaVersion: number };
        const contexts = (await request(
          reading.objectStore('instagramContext').getAll(),
        )) as unknown[];
        return {
          rejected,
          version: check.version,
          metaVersion: oldMeta.schemaVersion,
          contexts,
        };
      } finally {
        check.close();
      }
    }
    if (!upgraded) throw new Error('Upgrade failed');
    const first = await upgraded.read(readWorkspace);
    let duplicateRejected = false;
    try {
      await upgraded.write((tx) =>
        tx.instagramContext.add(first.instagramContext![0]!),
      );
    } catch {
      duplicateRejected = true;
    }
    const addOnly = await upgraded.write((tx) =>
      Promise.resolve(
        !('put' in tx.instagramContext) && !('remove' in tx.instagramContext),
      ),
    );
    await upgraded.close();
    upgraded = undefined;
    const reopened = await IndexedDBStore.open(id);
    let second;
    try {
      second = await reopened.read(readWorkspace);
    } finally {
      await reopened.close();
    }
    const check = await request(indexedDB.open(`sp-ws-${id}`));
    const version = check.version;
    check.close();
    return { first, second, version, duplicateRejected, addOnly };
  } finally {
    if (descriptor && fail && legacyVersion === 8)
      Object.defineProperty(IDBObjectStore.prototype, 'put', descriptor);
    await upgraded?.close();
    await deleteWorkspaceDatabase(id);
  }
}
