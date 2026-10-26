import { expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from './sqlite-store.ts';
import { createMemoryStore } from '@socialprune/core/workspace/memory-store';
import {
  instagramContractItem,
  writeInstagramContextContract,
} from '@socialprune/core/workspace/store-contract';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { createBackup, readBackup } from '@socialprune/core/workspace/backup';

async function generatedV7(file: string) {
  const source = createMemoryStore();
  await writeInstagramContextContract(source);
  const value = await source.read(readWorkspace);
  await source.close();
  const first = value.instagramContext![0]!;
  const second = {
    ...structuredClone(first),
    itemId: first.itemId + '-list',
    attemptId: first.attemptId + '-list',
    confirmedBy: 'list' as const,
    comment: { id: null, createdAt: null, expandClicks: 0 },
  };
  value.items.push({ ...instagramContractItem(), id: second.itemId });
  value.counts.items++;
  value.instagramContext!.push(second);
  value.counts.instagramContext!++;
  const [send, settled] = value.browserAttempts!;
  value.browserAttempts!.push(
    { ...send!, seq: 3, attemptId: second.attemptId, itemId: second.itemId },
    {
      ...settled!,
      seq: 4,
      attemptId: settled!.attemptId + '-list',
      itemId: second.itemId,
      settles: second.attemptId,
    },
  );
  value.counts.browserAttempts! += 2;
  const initial = await SQLiteStore.open(file, { initial: value });
  await initial.close();
  const raw = new DatabaseSync(file);
  raw.exec(
    "DROP TRIGGER instagram_context_no_update; UPDATE instagram_context SET data=json_remove(data,'$.ownerCheck'); CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END; UPDATE meta SET data=json_set(data,'$.schemaVersion',7); PRAGMA user_version=7;",
  );
  raw.close();
  return value;
}
test('C29 SQLite v7 readonly projects both kinds without writes; upgrade copies before rewrite and recreates write-once guards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-owner-v7-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    const expected = await generatedV7(file);
    const before = await readFile(file);
    const readonly = await SQLiteStore.open(file, { readOnly: true });
    try {
      const value = await readonly.read(readWorkspace);
      expect(value.schemaVersion).toBe(7);
      expect(value.instagramContext).toEqual(expected.instagramContext);
      expect(
        (await readBackup(createBackup(readonly).chunks)).schemaVersion,
      ).toBe(11);
    } finally {
      await readonly.close();
    }
    expect(await readFile(file)).toEqual(before);
    expect(await readdir(directory)).toEqual(['socialprune.sqlite']);
    const original = Object.getOwnPropertyDescriptor(
      DatabaseSync.prototype,
      'exec',
    )!.value as (this: DatabaseSync, sql: string) => void;
    let exclusive = false,
      copied = false;
    const spy = vi
      .spyOn(DatabaseSync.prototype, 'exec')
      .mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql.includes('BEGIN EXCLUSIVE')) exclusive = true;
        if (sql.includes('DROP TRIGGER instagram_context_no_update')) {
          expect(exclusive).toBe(true);
          const files = readdirSync(directory).filter((name) =>
            name.endsWith('.before-migration.sqlite'),
          );
          expect(files).toHaveLength(1);
          expect(readFileSync(join(directory, files[0]!))).toEqual(before);
          copied = true;
        }
        return original.call(this, sql);
      });
    try {
      const store = await SQLiteStore.open(file);
      expect(await store.read(readWorkspace)).toEqual(expected);
      await store.close();
    } finally {
      spy.mockRestore();
    }
    expect(copied).toBe(true);
    const raw = new DatabaseSync(file);
    try {
      expect(raw.prepare('PRAGMA user_version').get()!.user_version).toBe(11);
      for (const sql of [
        "UPDATE instagram_context SET data='{}'",
        'DELETE FROM instagram_context',
      ])
        expect(() => raw.exec(sql)).toThrow('write-once');
    } finally {
      raw.close();
    }
    const after = await readFile(file);
    const reopened = await SQLiteStore.open(file);
    await reopened.close();
    expect(await readFile(file)).toEqual(after);
    expect(
      (await readdir(directory)).filter((name) =>
        name.endsWith('.before-migration.sqlite'),
      ),
    ).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('C29 SQLite v7 failed context rewrite rolls back data, version and write-once triggers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-owner-rollback-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    await generatedV7(file);
    const raw = new DatabaseSync(file);
    raw.exec(
      "DROP TRIGGER instagram_context_no_update; UPDATE instagram_context SET data=json_set(data,'$.post.code','invalid/code'); CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END;",
    );
    raw.close();
    const before = await readFile(file);
    let opened: SQLiteStore | undefined;
    try {
      await expect(
        (async () => {
          opened = await SQLiteStore.open(file);
        })(),
      ).rejects.toThrow();
    } finally {
      await opened?.close();
    }
    expect(await readFile(file)).toEqual(before);
    const check = new DatabaseSync(file);
    try {
      expect(check.prepare('PRAGMA user_version').get()!.user_version).toBe(7);
      for (const sql of [
        "UPDATE instagram_context SET data='{}'",
        'DELETE FROM instagram_context',
      ])
        expect(() => check.exec(sql)).toThrow('write-once');
    } finally {
      check.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
