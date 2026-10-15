import { test, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from './sqlite-store.ts';
import { fixtureWorkspace } from '../../e2e/fake-x/fixture.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { migrateOriginal } from '@socialprune/core';
import { writeInstagramContextContract } from '@socialprune/core/workspace/store-contract';

// Verbatim trigger from 77c60bc:apps/cli/src/workspace/browser-journal.ts.
const layout4FinishTrigger = `
CREATE TRIGGER IF NOT EXISTS browser_runs_finish_once BEFORE UPDATE ON browser_runs
WHEN (OLD.ended_at IS NOT NULL AND NOT (json_extract(OLD.data,'$.mode')='fill' AND json_extract(OLD.data,'$.endReason')='canary' AND json_extract(OLD.data,'$.canaryAcceptedAt') IS NULL AND json_extract(NEW.data,'$.canaryAcceptedAt') IS NOT NULL AND NEW.ended_at=OLD.ended_at AND json_remove(NEW.data,'$.canaryAcceptedAt')=json_remove(OLD.data,'$.canaryAcceptedAt'))) OR (NEW.ended_at IS NULL AND NOT (OLD.ended_at IS NULL AND json_remove(NEW.data,'$.pageOpens','$.lastPageOpenedAt')=json_remove(OLD.data,'$.pageOpens','$.lastPageOpenedAt') AND json_extract(NEW.data,'$.pageOpens')=coalesce(json_extract(OLD.data,'$.pageOpens'),0)+1)) OR NEW.run_id != OLD.run_id OR NEW.account_key != OLD.account_key
OR json_extract(NEW.data,'$.startedAt') != json_extract(OLD.data,'$.startedAt')
OR json_extract(NEW.data,'$.mode') != json_extract(OLD.data,'$.mode')
OR json_extract(NEW.data,'$.planHash') IS NOT json_extract(OLD.data,'$.planHash')
BEGIN SELECT RAISE(ABORT,'run-end-once'); END;
`;

test('layout 4 -> 5 preserves X originals and journal JSON byte for byte and copies the database first', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-layout4-')),
    path = join(directory, 'socialprune.sqlite');
  try {
    const store = await SQLiteStore.open(path, {
      initial: fixtureWorkspace(['1001']),
    });
    await store.write((tx) =>
      tx.originals.put(
        migrateOriginal({
          id: '910',
          status: 'fetched',
          fetchedAt: '2026-10-15T00:00:00.000Z',
          text: 'Generated X original',
          authorName: 'Generated',
          authorHandle: 'generated',
          photos: [],
          quotedId: null,
          parentId: null,
          raw: { generated: 'preserve' },
          textCompleteness: 'unknown',
          video: null,
        }),
      ),
    );
    await store.write(async (tx) => {
      const at = '2026-10-15T00:00:00.000Z';
      await tx.browserRuns.add({
        runId: 'x-migration',
        platform: 'x',
        accountKey: 'x:fixture-person',
        mode: 'delete',
        planHash: 'a'.repeat(64),
        startedAt: at,
        endedAt: at,
        endReason: 'error',
        bodyShapes: {},
        profileReport: null,
        pageOpens: 1,
      });
      await tx.browserAttempts.add({
        seq: 1,
        attemptId: 'x-migration-send',
        runId: 'x-migration',
        itemId: 'x:1001',
        action: 'delete-post',
        state: 'sending',
        settles: null,
        at,
        code: null,
      });
      await tx.browserAttempts.add({
        seq: 2,
        attemptId: 'x-migration-ambiguous',
        runId: 'x-migration',
        itemId: 'x:1001',
        action: 'delete-post',
        state: 'ambiguous',
        settles: 'x-migration-send',
        at,
        code: 'NO_RESPONSE',
      });
    });
    await store.close();
    const raw = new DatabaseSync(path);
    raw.exec(
      "DROP TABLE instagram_context; PRAGMA user_version=4; UPDATE meta SET data=json_set(data,'$.schemaVersion',4); DROP TRIGGER browser_runs_finish_once;",
    );
    raw.exec(layout4FinishTrigger);
    const oldTrigger = String(
      raw
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE name='browser_runs_finish_once'",
        )
        .get()!.sql,
    );
    expect(oldTrigger).toContain("json_extract(OLD.data,'$.mode')='fill'");
    expect(oldTrigger).not.toContain('context');
    const originals = raw.prepare('SELECT * FROM originals').all(),
      runs = raw.prepare('SELECT * FROM browser_runs').all(),
      attempts = raw.prepare('SELECT * FROM browser_attempts').all();
    raw.close();
    const bytes = await readFile(path);
    const readonly = await SQLiteStore.open(path, { readOnly: true });
    expect((await readonly.read(readWorkspace)).schemaVersion).toBe(4);
    await readonly.close();
    expect(await readFile(path)).toEqual(bytes);
    const upgraded = await SQLiteStore.open(path);
    expect((await upgraded.read(readWorkspace)).schemaVersion).toBe(5);
    expect(
      (await upgraded.read(readWorkspace)).instagramContext,
    ).toBeUndefined();
    await upgraded.close();
    const copy = (await readdir(directory)).find((file) =>
      file.endsWith('.before-migration.sqlite'),
    )!;
    expect(await readFile(join(directory, copy))).toEqual(bytes);
    const after = new DatabaseSync(path);
    try {
      expect(
        String(
          after
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE name='browser_runs_finish_once'",
            )
            .get()!.sql,
        ),
      ).toContain("IN ('fill','context')");
      expect(after.prepare('SELECT * FROM originals').all()).toEqual(originals);
      expect(after.prepare('SELECT * FROM browser_runs').all()).toEqual(runs);
      expect(after.prepare('SELECT * FROM browser_attempts').all()).toEqual(
        attempts,
      );
      expect(
        after
          .prepare(
            "SELECT strict FROM pragma_table_list WHERE name='instagram_context'",
          )
          .get()!.strict,
      ).toBe(1);
      expect(() =>
        after
          .prepare('INSERT INTO instagram_context VALUES(?,?)')
          .run('generated', 'not json'),
      ).toThrow();
    } finally {
      after.close();
    }
    const contextStore = await SQLiteStore.open(path);
    try {
      await writeInstagramContextContract(contextStore);
      expect(
        (await contextStore.read(readWorkspace)).browserRuns!.find(
          (run) => run.mode === 'context',
        )?.canaryAcceptedAt,
      ).toBe('2026-10-15T00:00:00.000Z');
    } finally {
      await contextStore.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('interrupted additive migration rolls back while the copied original stays byte-identical', async () => {
  const directory = await mkdtemp(
      join(tmpdir(), 'socialprune-layout4-interruption-'),
    ),
    path = join(directory, 'socialprune.sqlite');
  try {
    const store = await SQLiteStore.open(path, {
      initial: fixtureWorkspace(['1001']),
    });
    await store.close();
    const raw = new DatabaseSync(path);
    raw.exec(
      "DROP TABLE instagram_context; PRAGMA user_version=4; UPDATE meta SET data=json_set(data,'$.schemaVersion',4); DROP TRIGGER browser_runs_finish_once; CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT,'generated-interruption'); END;",
    );
    raw.exec(layout4FinishTrigger);
    raw.close();
    const bytes = await readFile(path);
    await expect(SQLiteStore.open(path)).rejects.toThrow();
    const copy = (await readdir(directory)).find((file) =>
      file.endsWith('.before-migration.sqlite'),
    )!;
    expect(await readFile(join(directory, copy))).toEqual(bytes);
    expect(await readFile(path)).toEqual(bytes);
    const after = new DatabaseSync(path);
    try {
      expect(
        String(
          after
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE name='browser_runs_finish_once'",
            )
            .get()!.sql,
        ),
      ).toContain("json_extract(OLD.data,'$.mode')='fill'");
      expect(after.prepare('PRAGMA user_version').get()!.user_version).toBe(4);
      expect(
        after
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='instagram_context'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      after.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
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
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(5);
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
