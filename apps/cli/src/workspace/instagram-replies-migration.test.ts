import { expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from './sqlite-store.ts';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import { writeInstagramContextContract } from '@socialprune/core/workspace/store-contract';
import { readWorkspace } from '@socialprune/core/workspace/store';
import {
  createBackup,
  readBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';

test.each([false, true])(
  'REPLIES-1 v11 to v12 copies before migration, invents no replies and rolls back failure=%s',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-replies-migration-'));
    const path = join(root, 'socialprune.sqlite');
    const memory = createMemoryStore();
    const prior = await writeInstagramContextContract(memory);
    const initial = await memory.read(readWorkspace);
    await memory.close();
    const first = await SQLiteStore.open(path, { initial });
    await first.close();
    const raw = new DatabaseSync(path);
    // Verbatim from sqlite-store.ts at base 0fa3746; a shallow CI checkout
    // must not need historical Git objects to construct the v11 fixture.
    const v11Trigger = `CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context WHEN
  json_extract(OLD.data,'$.confirmedBy')!='post' OR json_type(OLD.data,'$.likes') IS NOT NULL OR
  json_type(NEW.data,'$.likes') IS NOT 'object' OR
  json_remove(OLD.data,'$.likes')!=json_remove(NEW.data,'$.likes')
BEGIN SELECT RAISE(ABORT,'write-once'); END;`;
    raw.exec('DROP TRIGGER instagram_context_no_update; ' + v11Trigger);
    raw.exec(
      "UPDATE meta SET data=json_set(data,'$.schemaVersion',11); PRAGMA user_version=11;",
    );
    expect(() =>
      raw.prepare('UPDATE instagram_context SET data=? WHERE item_id=?').run(
        JSON.stringify({
          ...prior,
          replies: { entries: [], moreCount: 0, capped: false },
        }),
        prior.itemId,
      ),
    ).toThrow(/write-once/);
    raw.close();
    const before = await readFile(path);
    // Applied to the intercepted database by the scoped migration spy.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = DatabaseSync.prototype.exec;
    const spy = failure
      ? vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
          this: DatabaseSync,
          sql: string,
        ) {
          if (sql.includes('DROP TRIGGER instagram_context_no_update'))
            throw new Error('Generated replies rollback');
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
        expect((await store.read(readWorkspace)).schemaVersion).toBe(12);
        expect(
          await store.read((tx) => tx.instagramContext.get(prior.itemId)),
        ).toEqual(prior);
        const next = {
          ...prior,
          replies: { entries: [], moreCount: 0, capped: false },
        };
        await store.write((tx) => tx.instagramContext.fillReplies(next));
        await expect(
          store.write((tx) => tx.instagramContext.fillReplies(next)),
        ).rejects.toThrow();
        const restored = createMemoryStore();
        try {
          await restoreBackup(restored, createBackup(store).chunks);
          expect(
            (await readBackup(createBackup(restored).chunks)).instagramContext,
          ).toEqual([next]);
        } finally {
          await restored.close();
        }
        // The frozen v11 package's actual admission ceiling is 11. New layout is
        // rejected before records are read, rather than silently losing replies.
        const db = new DatabaseSync(path);
        expect(
          Number(db.prepare('PRAGMA user_version').get()!.user_version) > 11,
        ).toBe(true);
        db.close();
      } finally {
        await store.close();
      }
      const copies = (await readdir(root)).filter((name) =>
        name.endsWith('.before-migration.sqlite'),
      );
      expect(copies).toHaveLength(1);
      expect(await readFile(join(root, copies[0]!))).toEqual(before);
    } finally {
      spy?.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);
