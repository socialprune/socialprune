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
import { WorkspaceMetaSchema } from '@socialprune/core';
import {
  runStoreContract,
  writeInstagramContextContract,
} from '@socialprune/core/workspace/store-contract';

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

export async function contextFoundation(): Promise<{
  checks: string[];
  workspace: unknown;
}> {
  const checks: string[] = [];
  await runStoreContract(
    async (initial) => {
      const id = `context-contract-${crypto.randomUUID()}`;
      let store = await IndexedDBStore.open(id, initial);
      return {
        store,
        async reopen() {
          await store.close();
          store = await IndexedDBStore.open(id);
          return store;
        },
        async dispose() {
          await store.close();
          await deleteWorkspaceDatabase(id);
        },
      };
    },
    (name) => checks.push(name),
  );
  const id = `context-lifecycle-${crypto.randomUUID()}`,
    store = await IndexedDBStore.open(id);
  try {
    await writeInstagramContextContract(store);
    return { checks, workspace: await store.read(readWorkspace) };
  } finally {
    await store.close();
    await deleteWorkspaceDatabase(id);
  }
}
Object.assign(globalThis, { contextFoundation });

export async function upgradeDecoy(): Promise<{
  version: number;
  originalPreserved: boolean;
  tables: string[];
}> {
  const id = `upgrade-journal-${crypto.randomUUID()}`,
    name = `sp-ws-${id}`;
  let store = await IndexedDBStore.open(id, createWorkspace({ id }));
  await store.close();
  // Pin layout 4, before the Instagram context store existed. Copy its metadata
  // and original record back before the additive production upgrade.
  await deleteWorkspaceDatabase(id);
  const opened = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 4);
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
      db.createObjectStore('browserRuns', { keyPath: 'runId' });
      const attempts = db.createObjectStore('browserAttempts', {
        keyPath: 'attemptId',
      });
      attempts.createIndex('seq', 'seq', { unique: true });
      attempts.createIndex('settles', 'settles', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Upgrade decoy open failed'));
  });
  // Select historical metadata explicitly. A rest projection of the current
  // workspace also includes newer record arrays, which strict metadata rejects.
  const workspace = createWorkspace({ id });
  const meta = WorkspaceMetaSchema.parse({
    format: workspace.format,
    schemaVersion: 4,
    id,
    kind: workspace.kind,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    lastBackupAt: workspace.lastBackupAt,
    settings: {
      categories: workspace.settings.categories,
      timeZone: workspace.settings.timeZone,
    },
  });
  const tx = opened.transaction(['meta', 'runtime', 'originals'], 'readwrite');
  tx.objectStore('meta').put(meta, 'workspace');
  tx.objectStore('runtime').put({ revision: 0, lastEventSeq: 0 }, 'runtime');
  tx.objectStore('originals').put({
    id: '901',
    anonymous: { status: 'fetched', at: '2026-10-12T00:00:00.000Z' },
    signedIn: null,
    text: 'Generated prior record',
    authorName: 'Generated',
    authorHandle: 'generated',
    media: [],
    createdAt: null,
    textSource: 'anonymous',
    conversationId: null,
    chainAbove: null,
    signedInRecord: null,
    quotedId: null,
    parentId: null,
    raw: { note_tweet: {} },
    textCompleteness: 'unknown',
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error('Upgrade decoy write failed'));
  });
  opened.close();
  try {
    store = await IndexedDBStore.open(id);
    const originalPreserved = Boolean(
      await store.read(async (value) => value.originals.get('901')),
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
