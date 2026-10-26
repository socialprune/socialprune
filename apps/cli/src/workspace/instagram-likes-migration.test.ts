import { expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from './sqlite-store.ts';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import { writeInstagramContextContract } from '@socialprune/core/workspace/store-contract';
import { readWorkspace } from '@socialprune/core/workspace/store';

test.each([false, true])(
  'v10 to v11 retains confirmation and copies before migration, rollback=%s',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-likes-migration-'));
    const path = join(root, 'socialprune.sqlite');
    const memory = createMemoryStore();
    const prior = await writeInstagramContextContract(memory);
    const initial = await memory.read(readWorkspace);
    await memory.close();
    const first = await SQLiteStore.open(path, { initial });
    await first.close();
    const raw = new DatabaseSync(path);
    raw.exec(
      "UPDATE meta SET data=json_set(data,'$.schemaVersion',10); PRAGMA user_version=10;",
    );
    raw.close();
    const before = await readFile(path);
    const original = Object.getOwnPropertyDescriptor(
      DatabaseSync.prototype,
      'exec',
    )!.value as DatabaseSync['exec'];
    const spy = failure
      ? vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
          this: DatabaseSync,
          sql: string,
        ) {
          if (sql.includes('DROP TRIGGER instagram_context_no_update'))
            throw new Error('Generated migration failure');
          return original.call(this, sql);
        })
      : undefined;
    try {
      if (failure) {
        await expect(SQLiteStore.open(path)).rejects.toThrow();
        spy!.mockRestore();
        expect(await readFile(path)).toEqual(before);
        return;
      }
      const store = await SQLiteStore.open(path);
      try {
        expect((await store.read(readWorkspace)).instagramContext).toEqual([
          prior,
        ]);
        await store.write((tx) =>
          tx.instagramContext.fillLikes({
            ...prior,
            likes: { count: null, source: null },
          }),
        );
        await expect(
          store.write((tx) =>
            tx.instagramContext.fillLikes({
              ...prior,
              likes: { count: 4, source: 'answer' },
            }),
          ),
        ).rejects.toThrow();
        await expect(
          store.write((tx) =>
            tx.instagramContext.fillLikes({
              ...prior,
              post: { ...prior.post, code: 'Changed' },
              likes: { count: 4, source: 'answer' },
            }),
          ),
        ).rejects.toThrow();
      } finally {
        await store.close();
      }
      const files = (await readdir(root)).filter((name) =>
        name.endsWith('.before-migration.sqlite'),
      );
      expect(files).toHaveLength(1);
      expect(await readFile(join(root, files[0]!))).toEqual(before);
    } finally {
      spy?.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);
