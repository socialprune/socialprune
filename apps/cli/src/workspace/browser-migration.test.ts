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
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { createBackup, readBackup } from '@socialprune/core/workspace/backup';
import { instagramFixture } from '../../e2e/fake-instagram/fixture.ts';
import { importWorkspace } from './services.ts';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { fileURLToPath } from 'node:url';

test.each([
  'adapter validation',
  'openWorkspace dry run',
  'import --dry-run',
  'backup export --dry-run',
  'read-only backup reader',
  'summary',
  'review --dry-run',
  'context instagram --dry-run',
  'batch next',
] as const)(
  'C10 revision literal layout 5 with one context supports %s without changing file bytes',
  async (consumer) => {
    const directory = await mkdtemp(join(tmpdir(), 'socialprune-v5-readonly-')),
      path = join(directory, 'socialprune.sqlite'),
      fixture = await instagramFixture();
    try {
      const initial = await SQLiteStore.open(path, {
        initial: fixture.workspace,
      });
      await writeInstagramContextContract(initial, fixture.items[0]);
      await initial.close();
      const raw = new DatabaseSync(path);
      raw.exec(
        "DROP TRIGGER instagram_context_no_update; UPDATE instagram_context SET data=json_remove(data,'$.confirmedBy'); CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END; PRAGMA user_version=5; UPDATE meta SET data=json_set(data,'$.schemaVersion',5);",
      );
      expect(
        raw.prepare('SELECT count(*) AS count FROM instagram_context').get()!
          .count,
      ).toBe(1);
      expect(
        String(raw.prepare('SELECT data FROM instagram_context').get()!.data),
      ).not.toContain('confirmedBy');
      raw.close();
      const before = await readFile(path);
      const archive = fileURLToPath(
        new URL(
          '../../../../fixtures/synthetic/x/current-minimal/archive/',
          import.meta.url,
        ),
      );
      try {
        if (
          consumer === 'adapter validation' ||
          consumer === 'read-only backup reader'
        ) {
          const store = await SQLiteStore.open(path, { readOnly: true });
          try {
            const memory =
              consumer === 'adapter validation'
                ? createMemoryStore(
                    new MemoryStoreBacking(await store.read(readWorkspace)),
                  )
                : undefined;
            const workspace = memory
              ? await memory.read(readWorkspace)
              : await readBackup(createBackup(store).chunks);
            await memory?.close();
            expect(workspace.schemaVersion).toBe(6);
            expect(workspace.instagramContext).toHaveLength(1);
            expect(workspace.instagramContext![0]).toHaveProperty(
              'confirmedBy',
              'post',
            );
          } finally {
            await store.close();
          }
        } else if (consumer === 'openWorkspace dry run') {
          const result = await importWorkspace({
            workspace: directory,
            paths: [archive],
            dryRun: true,
            signal: new AbortController().signal,
            now: () => new Date('2026-10-19T00:00:00.000Z'),
          });
          expect(result.data).toMatchObject({ dryRun: true, imports: 1 });
          expect(result.data.items).toBeGreaterThan(0);
        } else {
          const args =
            consumer === 'import --dry-run'
              ? ['import', archive, '--dry-run']
              : consumer === 'backup export --dry-run'
                ? [
                    'backup',
                    'export',
                    '--out',
                    join(directory, 'backup.json'),
                    '--dry-run',
                  ]
                : consumer === 'review --dry-run'
                  ? ['review', '--dry-run']
                  : consumer === 'context instagram --dry-run'
                    ? [
                        'context',
                        'instagram',
                        '--account',
                        fixture.items[0]!.account.key,
                        '--dry-run',
                      ]
                    : consumer === 'batch next'
                      ? ['batch', 'next', '--share-with-agent']
                      : ['summary'];
          const stdout: string[] = [],
            stderr: string[] = [];
          const code = await executeCli(
            [...args, '--workspace', directory, '--json'],
            createNodeContext(
              { write: (text) => stdout.push(text) },
              { write: (text) => stderr.push(text) },
            ),
          );
          expect(code, stdout.join('') + stderr.join('')).toBe(0);
          expect(JSON.parse(stdout.join(''))).toHaveProperty('status', 'ok');
        }
      } finally {
        expect(await readFile(path)).toEqual(before);
        expect(await readdir(directory)).toEqual(['socialprune.sqlite']);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// Verbatim trigger from 77c60bc:apps/cli/src/workspace/browser-journal.ts.
test('C10 layout 5 to 6 copies first, rewrites existing records as post and restores both write-once triggers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-layout5-')),
    path = join(directory, 'socialprune.sqlite');
  try {
    const store = await SQLiteStore.open(path, {
      initial: fixtureWorkspace(['1001']),
    });
    await writeInstagramContextContract(store);
    await store.close();
    const raw = new DatabaseSync(path);
    raw.exec(
      "DROP TRIGGER instagram_context_no_update; UPDATE instagram_context SET data=json_remove(data,'$.confirmedBy'); CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END; PRAGMA user_version=5; UPDATE meta SET data=json_set(data,'$.schemaVersion',5);",
    );
    const old = raw.prepare('SELECT data FROM instagram_context').get()!.data;
    raw.close();
    const bytes = await readFile(path);
    const readOnly = await SQLiteStore.open(path, { readOnly: true });
    try {
      expect(
        (await readOnly.read(readWorkspace)).instagramContext![0],
      ).toHaveProperty('confirmedBy', 'post');
    } finally {
      await readOnly.close();
    }
    expect(await readFile(path)).toEqual(bytes);
    const upgraded = await SQLiteStore.open(path);
    try {
      expect(
        (await upgraded.read(readWorkspace)).instagramContext![0],
      ).toHaveProperty('confirmedBy', 'post');
      expect((await upgraded.read(readWorkspace)).schemaVersion).toBe(6);
    } finally {
      await upgraded.close();
    }
    const copies = (await readdir(directory)).filter((file) =>
      file.endsWith('.before-migration.sqlite'),
    );
    expect(copies).toHaveLength(1);
    expect(await readFile(join(directory, copies[0]!))).toEqual(bytes);
    const db = new DatabaseSync(path);
    try {
      const record = JSON.parse(
        String(db.prepare('SELECT data FROM instagram_context').get()!.data),
      ) as Record<string, unknown>;
      expect(record.confirmedBy).toBe('post');
      delete record.confirmedBy;
      expect(record).toEqual(JSON.parse(String(old)));
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(6);
      expect(() =>
        db.exec(
          "UPDATE instagram_context SET data=json_set(data,'$.post.caption','changed')",
        ),
      ).toThrow('write-once');
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

const layout4FinishTrigger = `
CREATE TRIGGER IF NOT EXISTS browser_runs_finish_once BEFORE UPDATE ON browser_runs
WHEN (OLD.ended_at IS NOT NULL AND NOT (json_extract(OLD.data,'$.mode')='fill' AND json_extract(OLD.data,'$.endReason')='canary' AND json_extract(OLD.data,'$.canaryAcceptedAt') IS NULL AND json_extract(NEW.data,'$.canaryAcceptedAt') IS NOT NULL AND NEW.ended_at=OLD.ended_at AND json_remove(NEW.data,'$.canaryAcceptedAt')=json_remove(OLD.data,'$.canaryAcceptedAt'))) OR (NEW.ended_at IS NULL AND NOT (OLD.ended_at IS NULL AND json_remove(NEW.data,'$.pageOpens','$.lastPageOpenedAt')=json_remove(OLD.data,'$.pageOpens','$.lastPageOpenedAt') AND json_extract(NEW.data,'$.pageOpens')=coalesce(json_extract(OLD.data,'$.pageOpens'),0)+1)) OR NEW.run_id != OLD.run_id OR NEW.account_key != OLD.account_key
OR json_extract(NEW.data,'$.startedAt') != json_extract(OLD.data,'$.startedAt')
OR json_extract(NEW.data,'$.mode') != json_extract(OLD.data,'$.mode')
OR json_extract(NEW.data,'$.planHash') IS NOT json_extract(OLD.data,'$.planHash')
BEGIN SELECT RAISE(ABORT,'run-end-once'); END;
`;

test('layout 4 -> 6 preserves X originals and journal JSON byte for byte and copies the database first', async () => {
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
    expect((await upgraded.read(readWorkspace)).schemaVersion).toBe(6);
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
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(6);
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
