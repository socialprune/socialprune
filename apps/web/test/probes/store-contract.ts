import '@socialprune/core/browser-init';
import { runStoreContract } from '@socialprune/core/workspace/store-contract';
import type { StoreContractFactory } from '@socialprune/core/workspace/store-contract';
import {
  IndexedDBStore,
  deleteWorkspaceDatabase,
} from '../../src/workspace/idb-store.ts';
import { stageRestore } from '../../src/workspace/backup.ts';
import { createBackup } from '@socialprune/core/workspace/backup';
import { activeWorkspace } from '../../src/workspace/registry.ts';
import { ReviewService } from '@socialprune/core/workspace/review';
import { QueryEngine } from '@socialprune/core/workspace/query';

export async function runBrowserStoreContract(): Promise<string[]> {
  const passed: string[] = [];
  const factory: StoreContractFactory = async (initial) => {
    const id = `contract-${crypto.randomUUID()}`;
    let store = await IndexedDBStore.open(id, initial);
    return {
      store,
      async reopen() {
        await store.close();
        store = await IndexedDBStore.open(id, initial);
        return store;
      },
      async dispose() {
        await store.close();
        await deleteWorkspaceDatabase(id);
      },
    };
  };
  await runStoreContract(factory, (name) => passed.push(name));
  return passed;
}

export async function restoreFixtureWorkspace(
  initial: import('@socialprune/core').WorkspaceV2,
) {
  const id = `backup-${crypto.randomUUID()}`;
  const store = await IndexedDBStore.open(id, initial);
  let text = '';
  try {
    const backup = createBackup(store, { batchSize: 1000 });
    for await (const chunk of backup.chunks)
      text += new TextDecoder().decode(chunk);
    await backup.complete();
    const before = await activeWorkspace();
    let corruptRejected = false;
    try {
      await stageRestore(new Blob([text.slice(0, -32)]));
    } catch {
      corruptRejected = true;
    }
    const afterCorrupt = await activeWorkspace();
    const stage = await stageRestore(new Blob([text]));
    const restored = await stage.store.read(async (tx) => {
      const meta = await tx.meta.get();
      const submissions = [];
      for await (const value of tx.submissions.iterate())
        submissions.push(value);
      const decisions = [];
      for await (const value of tx.decisionEvents.iterate())
        decisions.push(value);
      const outcomes = [];
      for await (const value of tx.outcomeEvents.iterate())
        outcomes.push(value);
      return {
        meta,
        submissions,
        decisions,
        outcomes,
        runtime: await tx.runtime.get(),
      };
    });
    const service = new ReviewService(stage.store, {
      via: 'web-review',
      query: new QueryEngine(stage.store),
    });
    const history = await service.history();
    await stage.store.close();
    await deleteWorkspaceDatabase(stage.storageId);
    return {
      corruptRejected,
      activeUnchanged: before === afterCorrupt,
      restored,
      history,
    };
  } finally {
    await store.close();
    await deleteWorkspaceDatabase(id);
  }
}

export async function storageFailureControls() {
  const id = `failure-${crypto.randomUUID()}`;
  const lifecycle: string[] = [];
  const store = await IndexedDBStore.open(id, undefined, (state) =>
    lifecycle.push(state),
  );
  let quotaRejected = false;
  const descriptor = Object.getOwnPropertyDescriptor(
    IDBObjectStore.prototype,
    'put',
  );
  if (!descriptor) throw new Error('IndexedDB put descriptor missing.');
  const original = descriptor.value as (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) => IDBRequest;
  try {
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      ...descriptor,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'state')
          throw new DOMException(
            'Test-only quota failure.',
            'QuotaExceededError',
          );
        return original.call(this, value, key);
      },
    });
    try {
      await store.write(async (tx) => {
        const meta = await tx.meta.get();
        await tx.meta.set({ ...meta, updatedAt: '2026-02-01T00:00:00.000Z' });
        await tx.state.put({
          itemId: 'invented-quota',
          decision: 'delete',
          outcome: 'unknown',
        });
      });
    } catch (error) {
      quotaRejected = (error as DOMException).name === 'QuotaExceededError';
    }
  } finally {
    Object.defineProperty(IDBObjectStore.prototype, 'put', descriptor);
  }
  const rolledBack = await store.read(
    async (tx) =>
      (await tx.state.get('invented-quota')) === undefined &&
      (await tx.meta.get()).updatedAt !== '2026-02-01T00:00:00.000Z',
  );
  const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(`sp-ws-${id}`, 2);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () =>
      reject(open.error ?? new Error('Versionchange probe failed.'));
  });
  upgraded.close();
  await store.close();
  await deleteWorkspaceDatabase(id);
  return { quotaRejected, rolledBack, lifecycle };
}
