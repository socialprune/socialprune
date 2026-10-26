import { expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from './sqlite-store.ts';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import { writeInstagramContextContract } from '@socialprune/core/workspace/store-contract';

// These cases copy complete SQLite files and intercept an exclusive migration.
// Do not let the default five-second wall clock leave a live prototype spy when
// a loaded Windows filesystem delays completion.
vi.setConfig({ testTimeout: 60_000 });

async function generatedV8(file: string) {
  const store = await SQLiteStore.open(file, { initial: createWorkspace() });
  await writeInstagramContextContract(store);
  const expected = await store.read(readWorkspace);
  await store.close();
  const db = new DatabaseSync(file);
  db.exec(
    "DROP TABLE IF EXISTS browser_x_warning_ack; DROP TABLE IF EXISTS browser_x_warnings; UPDATE meta SET data=json_set(data,'$.schemaVersion',8); PRAGMA user_version=8;",
  );
  db.close();
  return { ...expected, schemaVersion: 11 };
}

test('C32 layout 8 to 9 copies under exclusive lock, preserves records without inventing warnings and retains write-once guards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-warning-v8-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    const expected = await generatedV8(file);
    const before = await readFile(file);
    const readonly = await SQLiteStore.open(file, { readOnly: true });
    expect((await readonly.read(readWorkspace)).schemaVersion).toBe(8);
    await readonly.close();
    expect(await readFile(file)).toEqual(before);
    // The spy applies this prototype method to the intercepted database below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = DatabaseSync.prototype.exec;
    let exclusive = false,
      copied = false;
    const spy = vi
      .spyOn(DatabaseSync.prototype, 'exec')
      .mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql.includes('BEGIN EXCLUSIVE')) exclusive = true;
        if (sql.includes('CREATE TABLE IF NOT EXISTS browser_x_warnings')) {
          expect(exclusive).toBe(true);
          const copies = readdirSync(directory).filter((name) =>
            name.endsWith('.before-migration.sqlite'),
          );
          expect(copies).toHaveLength(1);
          expect(readFileSync(join(directory, copies[0]!))).toEqual(before);
          copied = true;
        }
        return original.call(this, sql);
      });
    let upgraded: SQLiteStore | undefined;
    try {
      upgraded = await SQLiteStore.open(file);
      expect(await upgraded.read(readWorkspace)).toEqual(expected);
    } finally {
      await upgraded?.close();
      spy.mockRestore();
    }
    expect(copied).toBe(true);
    const db = new DatabaseSync(file);
    try {
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(11);
      for (const table of ['browser_x_warnings', 'browser_x_warning_ack'])
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(
          0,
        );
      for (const sql of [
        "UPDATE instagram_context SET data='{}'",
        'DELETE FROM instagram_context',
      ])
        expect(() => db.exec(sql)).toThrow('write-once');
      db.prepare(
        'INSERT INTO browser_x_warnings(run_id,account_key,at,zone,day,reason) VALUES(?,?,?,?,?,?)',
      ).run(
        'generated-warning',
        'x:generated',
        '2026-10-24T00:00:00.000Z',
        'UTC',
        '2026-10-24',
        'http-429',
      );
      db.prepare('INSERT INTO browser_x_warning_ack VALUES(?,?)').run(
        'generated-warning',
        '2026-10-25T00:00:00.000Z',
      );
      for (const table of ['browser_x_warnings', 'browser_x_warning_ack']) {
        expect(() =>
          db.exec(`UPDATE ${table} SET at='2026-10-26T00:00:00.000Z'`),
        ).toThrow('append-only');
        expect(() => db.exec(`DELETE FROM ${table}`)).toThrow('append-only');
      }
    } finally {
      db.close();
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

test('C32 failed layout 8 to 9 step rolls back metadata, layout and gate tables', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-warning-v8-rollback-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    await generatedV8(file);
    const before = await readFile(file);
    // The spy applies this prototype method to the intercepted database below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = DatabaseSync.prototype.exec;
    const spy = vi
      .spyOn(DatabaseSync.prototype, 'exec')
      .mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql.includes('PRAGMA user_version=11'))
          throw new Error('Generated migration failure');
        return original.call(this, sql);
      });
    let opened: SQLiteStore | undefined;
    try {
      await expect(
        (async () => {
          opened = await SQLiteStore.open(file);
        })(),
      ).rejects.toThrow('Generated migration failure');
    } finally {
      await opened?.close();
      spy.mockRestore();
    }
    expect(await readFile(file)).toEqual(before);
    const db = new DatabaseSync(file);
    try {
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(8);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='browser_x_warnings'",
          )
          .get(),
      ).toBeUndefined();
      expect(() => db.exec('DELETE FROM instagram_context')).toThrow(
        'write-once',
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('C32 version step preserves an existing D7 warning gate and its acknowledgement without adding warningKind to old runs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-warning-d7-v8-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    const store = await SQLiteStore.open(file, { initial: createWorkspace() });
    await writeInstagramContextContract(store);
    await store.close();
    const raw = new DatabaseSync(file);
    raw
      .prepare(
        'INSERT INTO browser_x_warnings(run_id,account_key,at,zone,day,reason) VALUES(?,?,?,?,?,?)',
      )
      .run(
        'generated-d7-warning',
        'x:generated',
        '2026-10-24T00:00:00.000Z',
        'UTC',
        '2026-10-24',
        'http-429',
      );
    raw
      .prepare('INSERT INTO browser_x_warning_ack VALUES(?,?)')
      .run('generated-d7-warning', '2026-10-25T00:00:00.000Z');
    const expectedWarnings = raw
      .prepare('SELECT * FROM browser_x_warnings')
      .all();
    const expectedAck = raw
      .prepare('SELECT * FROM browser_x_warning_ack')
      .all();
    raw.exec(
      "UPDATE meta SET data=json_set(data,'$.schemaVersion',8); PRAGMA user_version=8;",
    );
    raw.close();
    const migrated = await SQLiteStore.open(file);
    try {
      const value = await migrated.read(readWorkspace);
      expect(value.schemaVersion).toBe(11);
      expect(
        value.browserRuns!.every((run) => !Object.hasOwn(run, 'warningKind')),
      ).toBe(true);
    } finally {
      await migrated.close();
    }
    const db = new DatabaseSync(file);
    try {
      expect(db.prepare('SELECT * FROM browser_x_warnings').all()).toEqual(
        expectedWarnings,
      );
      expect(db.prepare('SELECT * FROM browser_x_warning_ack').all()).toEqual(
        expectedAck,
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
