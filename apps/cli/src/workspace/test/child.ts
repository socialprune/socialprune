import { SQLiteStore } from '../sqlite-store.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import { executeCli } from '../../cli/adapter.ts';
import { createWorkspace } from '@socialprune/core/workspace/store';
import type { WriteTransaction } from '@socialprune/core/workspace/store';

// Test entrypoint only. No production module imports this file or reads a test flag.
const [mode, path, ...args] = process.argv.slice(2);
if (mode === 'hold-read') {
  const store = await SQLiteStore.open(path!, { readOnly: true });
  process.send?.({ type: 'reading' });
  await new Promise<void>((resolve) => {
    process.once('message', () => resolve());
  });
  await store.close();
  process.disconnect?.();
} else if (mode === 'hold') {
  const { requireWorkspaceNode } = await import('../node-version.ts');
  requireWorkspaceNode(process.versions.node);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path!, { allowExtension: false });
  db.exec(
    'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;',
  );
  process.send?.({ type: 'holding' });
  await new Promise<void>((resolve) => {
    process.once('message', () => resolve());
  });
  db.exec('ROLLBACK;');
  db.close();
  process.disconnect?.();
} else if (mode === 'write') {
  try {
    const store = await SQLiteStore.open(path!);
    try {
      await store.write(async (tx) => {
        const runtime = await tx.runtime.get();
        await tx.runtime.set({ revision: runtime.revision + 1 });
      });
      process.send?.({ type: 'committed' });
    } finally {
      await store.close();
    }
  } catch (error) {
    process.send?.({
      type: 'error',
      code:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : null,
    });
    process.exitCode = 1;
  }
  process.disconnect?.();
} else if (mode === 'import-kill') {
  const store = await SQLiteStore.open(path!, { initial: createWorkspace() });
  await store.close();
  // Test-injected storage observation gates after a real committed item batch.
  const original = Reflect.get(SQLiteStore.prototype, 'write');
  SQLiteStore.prototype.write = async function <T>(
    operation: (tx: WriteTransaction) => Promise<T>,
  ): Promise<T> {
    const result: T = await Reflect.apply(original, this, [operation]);
    const items = await this.read(async (tx) => {
      let count = 0;
      for await (const _record of tx.items.iterate()) {
        void _record;
        count++;
      }
      return count;
    });
    if (items >= 1000) {
      process.send?.({ type: 'batch-committed', items });
      await new Promise<void>(() => {});
    }
    return result;
  };
  process.exitCode = await executeCli(
    [
      'import',
      ...args,
      '--workspace',
      path!.replace(/[\\/]socialprune\.sqlite$/, ''),
      '--json',
    ],
    createNodeContext(process.stdout, process.stderr),
  );
} else throw new Error('Unknown test child mode.');
