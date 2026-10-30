import { expect, test, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from './sqlite-store.ts';
import { legacyReviewFixture } from '../../../../packages/core/src/criteria/test-fixture.ts';
import { validateWorkspace } from '../../../../packages/core/src/workspace/validation.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { migrateReviewContract, feedCounts } from '@socialprune/core/criteria';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';

test('schema 6 to 7 copies before its first write, preserves both context kinds and triggers, and reopening is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-review-v6-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    const legacy = await legacyReviewFixture();
    expect(validateWorkspace(legacy)).toEqual(legacy);
    const initial = await SQLiteStore.open(file, { initial: legacy });
    await initial.close();
    const raw = new DatabaseSync(file);
    raw.exec(
      "DROP TABLE review_plans; DROP TRIGGER submissions_no_update; UPDATE submissions SET data=json_remove(data,'$.criteria'); CREATE TRIGGER submissions_no_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT,'append-only'); END; PRAGMA user_version=6;",
    );
    raw.close();
    const before = await readFile(file);
    const exec = Object.getOwnPropertyDescriptor(
      DatabaseSync.prototype,
      'exec',
    )!.value as (this: DatabaseSync, sql: string) => void;
    let firstMutationObserved = false;
    const writes = vi
      .spyOn(DatabaseSync.prototype, 'exec')
      .mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS review_plans')) {
          const copies = readdirSync(directory).filter((name) =>
            name.endsWith('.before-migration.sqlite'),
          );
          expect(copies).toHaveLength(1);
          expect(readFileSync(join(directory, copies[0]!))).toEqual(before);
          firstMutationObserved = true;
        }
        return exec.call(this, sql);
      });
    let upgraded: SQLiteStore;
    try {
      upgraded = await SQLiteStore.open(file);
    } finally {
      writes.mockRestore();
    }
    expect(firstMutationObserved).toBe(true);
    const actual = await upgraded.read(readWorkspace);
    await upgraded.close();
    expect(actual).toEqual({
      ...migrateReviewContract(legacy),
      schemaVersion: 12,
    });
    expect(
      actual.instagramContext!.map((record) => record.confirmedBy),
    ).toEqual(['post', 'list']);
    const copies = (await readdir(directory)).filter((name) =>
      name.endsWith('.before-migration.sqlite'),
    );
    expect(copies).toHaveLength(1);
    expect(await readFile(join(directory, copies[0]!))).toEqual(before);
    const after = await readFile(file);
    const reopened = await SQLiteStore.open(file);
    expect(await reopened.read(readWorkspace)).toEqual(actual);
    await reopened.close();
    expect(await readFile(file)).toEqual(after);
    expect(
      (await readdir(directory)).filter((name) =>
        name.endsWith('.before-migration.sqlite'),
      ),
    ).toEqual(copies);
    const db = new DatabaseSync(file);
    try {
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(12);
      expect(
        db
          .prepare(
            "SELECT strict FROM pragma_table_list WHERE name='review_plans'",
          )
          .get()!.strict,
      ).toBe(1);
      for (const sql of [
        "UPDATE instagram_context SET data='{}'",
        'DELETE FROM instagram_context',
      ])
        expect(() => db.exec(sql)).toThrow('write-once');
      db.prepare('INSERT INTO review_plans VALUES(?,?)').run(
        'generated-plan',
        '{}',
      );
      for (const sql of [
        "UPDATE review_plans SET data='{}'",
        'DELETE FROM review_plans',
      ])
        expect(() => db.exec(sql)).toThrow('append-only');
      for (const sql of [
        "UPDATE submissions SET data='{}'",
        'DELETE FROM submissions',
      ])
        expect(() => db.exec(sql)).toThrow('append-only');
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('summary JSON exposes all six tab counts on a generated workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-summary-feed-'));
  try {
    const workspace = migrateReviewContract(await legacyReviewFixture());
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      { initial: workspace },
    );
    await store.close();
    const stdout: string[] = [],
      stderr: string[] = [];
    const code = await executeCli(
      ['summary', '--workspace', directory, '--json'],
      createNodeContext(
        { write: (text) => stdout.push(text) },
        { write: (text) => stderr.push(text) },
      ),
    );
    expect(code, stderr.join('')).toBe(0);
    const result = JSON.parse(stdout.join('')) as { data: { tabs: unknown } };
    expect(result.data.tabs).toEqual({
      suggested: 1,
      held: 0,
      kept: 0,
      unclear: 0,
      marked: 0,
      all: 3,
    });
    expect(result.data.tabs).toEqual(feedCounts(workspace).tabs);
    console.log('GENERATED_SUMMARY_JSON', stdout.join('').trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
