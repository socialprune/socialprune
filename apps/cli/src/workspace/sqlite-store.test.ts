import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runStoreContract } from '@socialprune/core/workspace/store-contract';
import { SQLiteStore } from './sqlite-store.ts';
import { requireWorkspaceNode } from './node-version.ts';
import { browserWorkspace } from './test/inputs.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';

test('literal layout 5 and schema 5 remain readable through SQLiteStore.open after the writer version advances', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-literal-layout5-'),
  );
  const file = join(directory, 'socialprune.sqlite');
  try {
    const initial = await SQLiteStore.open(file, {
      initial: browserWorkspace(),
    });
    await initial.close();
    const pinned = new DatabaseSync(file);
    pinned.exec(
      "PRAGMA user_version=5; UPDATE meta SET data=json_set(data,'$.schemaVersion',5);",
    );
    pinned.close();
    const before = await readFile(file);
    for (const readOnly of [true, false]) {
      const opened = await SQLiteStore.open(file, { readOnly });
      try {
        expect((await opened.read(readWorkspace)).schemaVersion).toBe(
          readOnly ? 6 : 11,
        );
      } finally {
        await opened.close();
      }
      if (readOnly) expect(await readFile(file)).toEqual(before);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite satisfies every framework-neutral core store contract check', async () => {
  const checks: string[] = [];
  await runStoreContract(
    async (initial) => {
      const directory = await mkdtemp(
        join(tmpdir(), 'socialprune-c2-contract-'),
      );
      const file = join(directory, 'socialprune.sqlite');
      let store = await SQLiteStore.open(file, { initial });
      return {
        store,
        async reopen() {
          await store.close();
          store = await SQLiteStore.open(file);
          return store;
        },
        async dispose() {
          await store.close();
          await rm(directory, { recursive: true, force: true });
        },
      };
    },
    (name) => checks.push(name),
  );
  expect(checks).toHaveLength(14);
}, 60_000);

test('used SQLite API, strict layout, PRAGMAs and append-only triggers are real', async () => {
  requireWorkspaceNode(process.versions.node);
  const { DatabaseSync } = await import('node:sqlite');
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-api-'));
  const file = join(directory, 'socialprune.sqlite');
  const store = await SQLiteStore.open(file, { initial: browserWorkspace() });
  const connection = Reflect.get(
    store,
    'db',
  ) as import('node:sqlite').DatabaseSync;
  expect(connection.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2);
  expect(connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(connection.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(5000);
  expect(
    connection.prepare('PRAGMA trusted_schema').get()?.trusted_schema,
  ).toBe(0);
  const attack = "'); DELETE FROM submissions; -- generated SQL-looking input";
  await store.write(async (tx) => {
    const stored = await tx.items.get('x:101');
    await tx.items.put({ ...stored!, item: { ...stored!.item, text: attack } });
  });
  expect((await store.read((tx) => tx.items.get('x:101')))?.item.text).toBe(
    attack,
  );
  expect(
    await store.read((tx) => tx.submissions.get('generated-submission')),
  ).toBeDefined();
  await expect(
    store.write(async (tx) => {
      const submission = await tx.submissions.get('generated-submission');
      await tx.submissions.add(submission!);
    }),
  ).rejects.toMatchObject({ code: 'DUPLICATE_ID' });
  await expect(
    store.write(async (tx) => {
      await tx.outcomeEvents.append([
        {
          ...browserWorkspace().outcomeEvents[0]!,
          eventId: 'generated-collision',
          seq: 3,
        },
      ]);
    }),
  ).rejects.toMatchObject({ code: 'EVENT_SEQUENCE' });
  await store.close();
  const db = new DatabaseSync(file, { allowExtension: false });
  try {
    expect(typeof db.exec).toBe('function');
    expect(typeof db.prepare).toBe('function');
    expect(typeof db.close).toBe('function');
    const statement = db.prepare('SELECT ? AS value');
    expect(statement.get('bound-input')).toEqual({ value: 'bound-input' });
    expect(statement.all(7)).toEqual([{ value: 7 }]);
    expect(() => db.enableLoadExtension(true)).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe(
      'delete',
    );
    for (const table of [
      'meta',
      'imports',
      'items',
      'assessments',
      'submissions',
      'decision_events',
      'outcome_events',
      'state',
      'originals',
      'instagram_context',
      'browser_runs',
      'browser_attempts',
    ]) {
      expect(
        db
          .prepare('SELECT strict FROM pragma_table_list WHERE name=?')
          .get(table)?.strict,
      ).toBe(1);
    }
    for (const table of [
      'assessments',
      'submissions',
      'decision_events',
      'outcome_events',
    ]) {
      expect(() => db.exec(`UPDATE ${table} SET data='{}'`)).toThrow(
        'append-only',
      );
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow('append-only');
    }
    // The test guard demonstrably fails if a forbidden mutation succeeds.
    expect(() =>
      expect(() => db.exec('SELECT 1')).toThrow('append-only'),
    ).toThrow();
    const locked = await SQLiteStore.open(file);
    await locked.write(async (tx) => {
      await tx.runtime.set({ revision: 1 });
    });
    await locked.close();
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
