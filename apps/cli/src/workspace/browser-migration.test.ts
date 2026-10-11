import { test, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from './sqlite-store.ts';
import { fixtureWorkspace } from '../../e2e/fake-x/fixture.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
test('v2 SQLite additive migration preserves original bytes, copies first and readonly opens write nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-layout2-decoy-')),
    path = join(directory, 'socialprune.sqlite');
  try {
    const initialized = await SQLiteStore.open(path, {
      initial: fixtureWorkspace(['1001']),
    });
    await initialized.close();
    const raw = new DatabaseSync(path);
    raw.exec(
      'DROP TABLE browser_requests;DROP TABLE browser_attempts;DROP TABLE browser_runs;PRAGMA user_version=2;',
    );
    raw.close();
    const bytes = await readFile(path);
    const readonly = await SQLiteStore.open(path, { readOnly: true });
    expect((await readonly.browserJournal()).attempts).toEqual([]);
    await readonly.close();
    expect(await readFile(path)).toEqual(bytes);
    expect(await readdir(directory)).toEqual(['socialprune.sqlite']);
    const upgraded = await SQLiteStore.open(path);
    expect((await upgraded.read(readWorkspace)).items[0]!.id).toBe('x:1001');
    await upgraded.close();
    const copy = (await readdir(directory)).find((name) =>
      name.endsWith('.before-migration.sqlite'),
    )!;
    expect(await readFile(join(directory, copy))).toEqual(bytes);
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(3);
      expect(
        db
          .prepare("SELECT name FROM sqlite_schema WHERE name='originals'")
          .get(),
      ).toBeDefined();
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='browser_attempts'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
