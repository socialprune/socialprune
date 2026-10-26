import { expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from './sqlite-store.ts';
import { instagramDeleteFixture } from '../../e2e/fake-instagram/delete-fixture.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import {
  createBackup,
  readBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';

test.each([false, true])(
  'D10 version 9 to 10 copies before migration, failure=%s preserves rollback and context write-once evidence',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-d10-migration-'));
    const path = join(root, 'socialprune.sqlite');
    let store = await SQLiteStore.open(path, {
      initial: await instagramDeleteFixture(),
    });
    const expected = await store.read(readWorkspace);
    await store.close();
    const raw = new DatabaseSync(path);
    raw.exec(
      "DROP TABLE browser_instagram_warning_ack; DROP TABLE browser_instagram_warnings; UPDATE meta SET data=json_set(data,'$.schemaVersion',9); PRAGMA user_version=9;",
    );
    raw.close();
    const before = await readFile(path);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The generated fault wrapper invokes this method with the original database receiver.
    const original = DatabaseSync.prototype.exec;
    const fault = failure
      ? vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
          this: DatabaseSync,
          sql: string,
        ) {
          if (
            sql.includes(
              'CREATE TABLE IF NOT EXISTS browser_instagram_warnings',
            )
          )
            throw new Error('Generated migration failure');
          original.call(this, sql);
        })
      : undefined;
    try {
      if (failure) {
        await expect(SQLiteStore.open(path)).rejects.toThrow();
        fault!.mockRestore();
        expect(await readFile(path)).toEqual(before);
        return;
      }
      store = await SQLiteStore.open(path);
      expect(await store.read(readWorkspace)).toEqual(expected);
      const record = expected.instagramContext![0]!;
      await expect(
        store.write((tx) => tx.instagramContext.add(record)),
      ).rejects.toThrow();
      await store.close();
      const backups = (await readdir(root)).filter((name) =>
        name.endsWith('.before-migration.sqlite'),
      );
      expect(backups).toHaveLength(1);
      expect(await readFile(join(root, backups[0]!))).toEqual(before);
      const read = new DatabaseSync(path);
      expect(read.prepare('PRAGMA user_version').get()!.user_version).toBe(11);
      expect(
        read
          .prepare('SELECT count(*) AS n FROM browser_instagram_warnings')
          .get()!.n,
      ).toBe(0);
      expect(() =>
        read.prepare('UPDATE instagram_context SET data=data').run(),
      ).toThrow();
      expect(() =>
        read.prepare('UPDATE browser_attempts SET data=data').run(),
      ).toThrow();
      read.close();
    } finally {
      fault?.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);

test('D10 portable readers and staging retain an interrupted Instagram warning but refuse a schema-9 hybrid', async () => {
  const value = await instagramDeleteFixture(1);
  value.browserRuns!.push({
    runId: 'generated-interrupted-warning',
    platform: 'instagram',
    accountKey: value.items[0]!.account.key,
    mode: 'delete',
    planHash: 'b'.repeat(64),
    startedAt: '2026-10-25T12:00:00Z',
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
    instagramWarning: {
      at: '2026-10-25T12:00:00Z',
      kind: 'http-429',
      zone: 'Europe/Berlin',
    },
  });
  value.counts.browserRuns!++;
  const source = createMemoryStore(new MemoryStoreBacking(value));
  const target = createMemoryStore();
  try {
    let text = '';
    for await (const chunk of createBackup(source).chunks)
      text += new TextDecoder().decode(chunk);
    const chunks = (input: string) =>
      (async function* () {
        await Promise.resolve();
        yield input;
      })();
    const parsed = await readBackup(chunks(text));
    expect(parsed.schemaVersion).toBe(11);
    await restoreBackup(target, chunks(text));
    expect(
      (await target.read(readWorkspace)).browserRuns!.at(-1)?.instagramWarning
        ?.kind,
    ).toBe('http-429');
    const old = JSON.stringify({
      ...(JSON.parse(text) as object),
      schemaVersion: 9,
    });
    await expect(readBackup(chunks(old))).rejects.toThrow();
    await expect(restoreBackup(target, chunks(old))).rejects.toThrow();
  } finally {
    await source.close();
    await target.close();
  }
});
