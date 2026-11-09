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

test('REPLY-SET-2 v12 to v13 copies first, changes no record, then keeps a marked set through CLI and portable backups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-replyset-migration-'));
  const path = join(root, 'socialprune.sqlite');
  try {
    const memory = createMemoryStore();
    const prior = await writeInstagramContextContract(memory);
    const initial = await memory.read(readWorkspace);
    await memory.close();
    const first = await SQLiteStore.open(path, { initial });
    await first.close();
    const raw = new DatabaseSync(path);
    // Layout 12 differs from 13 only in the context update trigger.
    raw.exec(
      `DROP TRIGGER instagram_context_no_update; ${v12Trigger} UPDATE meta SET data=json_set(data,'$.schemaVersion',12); PRAGMA user_version=12;`,
    );
    const recordBefore = String(
      raw
        .prepare('SELECT data FROM instagram_context WHERE item_id=?')
        .get(prior.itemId)!.data,
    );
    raw.close();
    const before = await readFile(path);
    const store = await SQLiteStore.open(path);
    try {
      expect((await store.read(readWorkspace)).schemaVersion).toBe(13);
      expect(
        await store.read((tx) => tx.instagramContext.get(prior.itemId)),
      ).toEqual(prior);
      const marked = {
        ...prior,
        replies: {
          entries: [
            {
              account: 'generated_reply_0',
              text: 'Generated reply 0',
              createdAt: null,
              likes: { count: null, source: null },
              source: 'shown' as const,
            },
          ],
          moreCount: 2,
          capped: false,
          set: {
            state: 'incomplete' as const,
            declaredTotal: 3,
            hiddenCount: 2,
          },
        },
      };
      await store.write((tx) => tx.instagramContext.fillReplies(marked));
      // CLI -> portable reader (the browser's) -> CLI again.
      const portable = createMemoryStore();
      try {
        await restoreBackup(portable, createBackup(store).chunks);
        expect(
          (await portable.read((tx) => tx.instagramContext.get(prior.itemId)))
            ?.replies,
        ).toEqual(marked.replies);
        const empty = createMemoryStore();
        const blank = await empty.read(readWorkspace);
        await empty.close();
        const restored = await SQLiteStore.open(join(root, 'restored.sqlite'), {
          initial: blank,
        });
        try {
          await restoreBackup(restored, createBackup(portable).chunks);
          expect(
            (await readBackup(createBackup(restored).chunks)).instagramContext,
          ).toEqual([marked]);
        } finally {
          await restored.close();
        }
      } finally {
        await portable.close();
      }
    } finally {
      await store.close();
    }
    const copies = (await readdir(root)).filter((name) =>
      name.endsWith('.before-migration.sqlite'),
    );
    expect(copies).toHaveLength(1);
    expect(await readFile(join(root, copies[0]!))).toEqual(before);
    const copy = new DatabaseSync(join(root, copies[0]!), { readOnly: true });
    try {
      expect(
        String(
          copy
            .prepare('SELECT data FROM instagram_context WHERE item_id=?')
            .get(prior.itemId)!.data,
        ),
      ).toBe(recordBefore);
    } finally {
      copy.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Verbatim from sqlite-store.ts at main cb63964 (layout 12).
const v12Trigger = `CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context WHEN
  json_extract(OLD.data,'$.confirmedBy')!='post' OR NOT (
    (json_type(OLD.data,'$.likes') IS NULL AND json_type(NEW.data,'$.likes') IS 'object' AND json_remove(OLD.data,'$.likes')=json_remove(NEW.data,'$.likes')) OR
    (json_type(OLD.data,'$.replies') IS NULL AND json_type(NEW.data,'$.replies') IS 'object' AND json_remove(OLD.data,'$.replies')=json_remove(NEW.data,'$.replies'))
  )
BEGIN SELECT RAISE(ABORT,'write-once'); END;`;
const triggerSql = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return String(
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name='instagram_context_no_update'",
        )
        .get()!.sql,
    );
  } finally {
    db.close();
  }
};
const shownReply = {
  account: 'generated_reply_0',
  text: 'Generated reply 0',
  createdAt: null,
  likes: { count: null, source: null },
  source: 'shown' as const,
};
const incompleteSet = {
  entries: [shownReply],
  moreCount: 2,
  capped: false,
  set: { state: 'incomplete' as const, declaredTotal: 3, hiddenCount: 2 },
};
const completeSet = {
  entries: [
    shownReply,
    ...[1, 2].map((index) => ({
      account: `generated_reply_${index}`,
      text: `Generated reply ${index}`,
      createdAt: `2026-10-0${index}T12:00:00.000Z`,
      likes: { count: null, source: null },
      source: 'answer-only' as const,
    })),
  ],
  moreCount: 0,
  capped: false,
  set: { state: 'complete' as const },
};

test('REPLY-SET-2 a migrated v12 and a fresh v13 workspace end with the identical trigger, which allows one replacement of an incomplete set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-replyset-trigger-'));
  try {
    const memory = createMemoryStore();
    const prior = await writeInstagramContextContract(memory);
    const initial = await memory.read(readWorkspace);
    await memory.close();
    const fresh = join(root, 'fresh.sqlite'),
      migrated = join(root, 'migrated.sqlite');
    for (const path of [fresh, migrated])
      await (await SQLiteStore.open(path, { initial })).close();
    const raw = new DatabaseSync(migrated);
    raw.exec(
      `DROP TRIGGER instagram_context_no_update; ${v12Trigger} UPDATE meta SET data=json_set(data,'$.schemaVersion',12); PRAGMA user_version=12;`,
    );
    raw.close();
    // SQLite keeps the statement without its final semicolon.
    const v12Stored = triggerSql(migrated);
    expect(v12Stored).toBe(v12Trigger.replace(/;$/, ''));
    expect(v12Stored).not.toBe(triggerSql(fresh));
    await (await SQLiteStore.open(migrated)).close();
    expect(triggerSql(migrated)).toBe(triggerSql(fresh));
    for (const path of [fresh, migrated]) {
      const store = await SQLiteStore.open(path);
      try {
        await store.write((tx) =>
          tx.instagramContext.fillReplies({ ...prior, replies: incompleteSet }),
        );
        // The validator refuses a re-read that changes the stored reply.
        await expect(
          store.write((tx) =>
            tx.instagramContext.fillReplies({
              ...prior,
              replies: {
                ...completeSet,
                entries: [
                  { ...shownReply, text: 'Generated changed reply' },
                  ...completeSet.entries.slice(1),
                ],
              },
            }),
          ),
        ).rejects.toThrow('REPLY_SET_CONFLICT');
      } finally {
        await store.close();
      }
      // The trigger alone, bypassing the validator.
      const db = new DatabaseSync(path);
      try {
        const update = (data: string) =>
          db
            .prepare('UPDATE instagram_context SET data=? WHERE item_id=?')
            .run(data, prior.itemId);
        const current = () =>
          JSON.parse(
            String(
              db
                .prepare('SELECT data FROM instagram_context WHERE item_id=?')
                .get(prior.itemId)!.data,
            ),
          ) as Record<string, unknown>;
        const base = current();
        for (const next of [
          { ...base, replies: { ...incompleteSet, moreCount: 1 } },
          { ...base, replies: { ...completeSet, moreCount: 1 } },
          { ...base, replies: { ...completeSet, capped: true } },
          { ...base, runId: 'generated-other', replies: completeSet },
        ])
          expect(() => update(JSON.stringify(next))).toThrow('write-once');
        update(JSON.stringify({ ...base, replies: completeSet }));
        expect(current().replies).toEqual(completeSet);
        for (const next of [
          { ...base, replies: incompleteSet },
          { ...base, replies: { ...completeSet, entries: [shownReply] } },
        ])
          expect(() => update(JSON.stringify(next))).toThrow('write-once');
      } finally {
        db.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([false, true])(
  'REPLIES-1 v11 to current copies before migration, invents no replies and rolls back failure=%s',
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
        expect((await store.read(readWorkspace)).schemaVersion).toBe(13);
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
