import { expect, test } from 'vitest';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import type { WorkspaceStore } from './store.ts';
import { contractWorkspace, STORE_CONTRACT_CHECKS } from './store-contract.ts';
import type { StoreContractFactory } from './store-contract.ts';

export const memoryFactory: StoreContractFactory = (initial) => {
  const backing = new MemoryStoreBacking(initial);
  let store = createMemoryStore(backing);
  return Promise.resolve({
    store,
    async reopen() {
      await store.close();
      store = createMemoryStore(backing);
      return store;
    },
    dispose: () => store.close(),
  });
};
test.each(STORE_CONTRACT_CHECKS)(
  'memory-store contract: $name',
  async (check) => {
    await check.run(memoryFactory);
  },
);
test('detachment contract fails on a store that exposes mutable read records', async () => {
  const workspace = contractWorkspace();
  const live = {
    item: workspace.items[0]!,
    importId: '',
    metadataImportId: '',
  };
  const factory: StoreContractFactory = (initial) => {
    const original = createMemoryStore(new MemoryStoreBacking(initial));
    const broken: WorkspaceStore = {
      read: (operation) =>
        original.read((tx) =>
          operation({
            ...tx,
            items: { ...tx.items, get: () => Promise.resolve(live) },
          }),
        ),
      write: (operation) => original.write(operation),
      close: () => original.close(),
    };
    return Promise.resolve({
      store: broken,
      reopen: () => Promise.resolve(broken),
      dispose: () => broken.close(),
    });
  };
  await expect(STORE_CONTRACT_CHECKS[0]!.run(factory)).rejects.toThrow(
    'read returned live mutable data',
  );
});
