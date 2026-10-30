import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  OriginalSchema,
  migrateOriginal,
  validateOriginal,
  SubmissionSchema,
  WorkspaceMetaSchema,
  WorkspaceV2Schema,
  BrowserRunSchema,
  validateBrowserRunUpdate,
  BrowserAttemptSchema,
  InstagramContextSchema,
  validateInstagramLikesFill,
  validateInstagramRepliesFill,
  migrateInstagramContext,
  WORKSPACE_SCHEMA_VERSION,
  ReviewPlanSchema,
} from '@socialprune/core';
import type {
  WorkspaceV2,
  Original,
  OutcomeEvent,
  BrowserRun,
  BrowserAttempt,
  InstagramContext,
} from '@socialprune/core';
import {
  importForItem,
  initialState,
  iterationBounds,
} from '@socialprune/core/workspace/store';
import type {
  AppendWriter,
  CommandReceipt,
  IterationOptions,
  MigrationEvent,
  ReadTransaction,
  StoredItem,
  StoredState,
  WorkspaceRuntime,
  WorkspaceStore,
  WriteTransaction,
} from '@socialprune/core/workspace/store';
import { CliError } from '../cli/errors.ts';
import { requireWorkspaceNode } from './node-version.ts';
import {
  BrowserOutcomeWriter,
  readJournal,
  BROWSER_JOURNAL_LAYOUT,
  X_WARNING_LAYOUT,
  INSTAGRAM_WARNING_LAYOUT,
} from './browser-journal.ts';
import { journalExists } from './browser-journal.ts';
import {
  migrateReviewSettings,
  migrateSubmission,
} from '@socialprune/core/criteria';

// Physical layouts have their own history, independent of backup writers.
export const SQLITE_LAYOUT_VERSION = 12;

const plansLayout = `
CREATE TABLE IF NOT EXISTS review_plans (action_id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TRIGGER IF NOT EXISTS review_plans_no_update BEFORE UPDATE ON review_plans BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS review_plans_no_delete BEFORE DELETE ON review_plans BEGIN SELECT RAISE(ABORT,'append-only'); END;
`;

const contextLayout = `
CREATE TABLE instagram_context (
  item_id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))
) STRICT;
CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context WHEN
  json_extract(OLD.data,'$.confirmedBy')!='post' OR NOT (
    (json_type(OLD.data,'$.likes') IS NULL AND json_type(NEW.data,'$.likes') IS 'object' AND json_remove(OLD.data,'$.likes')=json_remove(NEW.data,'$.likes')) OR
    (json_type(OLD.data,'$.replies') IS NULL AND json_type(NEW.data,'$.replies') IS 'object' AND json_remove(OLD.data,'$.replies')=json_remove(NEW.data,'$.replies'))
  )
BEGIN SELECT RAISE(ABORT,'write-once'); END;
CREATE TRIGGER instagram_context_no_delete BEFORE DELETE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END;
`;

const originalsLayout = `
CREATE TABLE originals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('fetched','not-found','tombstone','failed')),
  fetchedAt TEXT NOT NULL, text TEXT, authorName TEXT, authorHandle TEXT,
  photos TEXT NOT NULL CHECK(json_valid(photos)), quotedId TEXT, parentId TEXT,
  raw TEXT CHECK(raw IS NULL OR json_valid(raw)),
  textCompleteness TEXT NOT NULL CHECK(textCompleteness IN ('unknown','truncated')),
  video TEXT CHECK(video IS NULL OR video='not-stored')
) STRICT;
PRAGMA user_version=2;
`;

// The port exposes rejection codes, not the core's private error constructor.
class WorkspaceError extends Error {
  readonly code: 'STORAGE' | 'DUPLICATE_ID' | 'EVENT_SEQUENCE';
  constructor(code: 'STORAGE' | 'DUPLICATE_ID' | 'EVENT_SEQUENCE') {
    super(code);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

const layout = `
CREATE TABLE meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  last_event_seq INTEGER NOT NULL CHECK (last_event_seq >= 0)
) STRICT;
CREATE TABLE imports (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT;
CREATE TABLE items (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL, metadata_import_id TEXT NOT NULL,
  likes INTEGER, reposts INTEGER, data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX items_import_id ON items(import_id);
CREATE TABLE submissions (submission_id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT;
CREATE TABLE assessments (
  seq INTEGER PRIMARY KEY, assessment_id TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX assessments_item_id ON assessments(item_id);
CREATE TABLE event_sequences (seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE) STRICT;
CREATE TABLE decision_events (
  seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)),
  FOREIGN KEY (seq) REFERENCES event_sequences(seq)
) STRICT;
CREATE INDEX decision_events_item_id ON decision_events(item_id);
CREATE TABLE outcome_events (
  seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)),
  FOREIGN KEY (seq) REFERENCES event_sequences(seq)
) STRICT;
CREATE INDEX outcome_events_item_id ON outcome_events(item_id);
CREATE TABLE state (item_id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT;
CREATE TABLE commands (command_id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT;
CREATE TABLE migration_events (
  id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, kind_order INTEGER NOT NULL,
  array_index INTEGER NOT NULL, data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX migration_events_order ON migration_events(timestamp, kind_order, array_index);
${[
  'assessments',
  'submissions',
  'decision_events',
  'outcome_events',
  'event_sequences',
  'commands',
]
  .map(
    (table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only'); END;`,
  )
  .join('\n')}
${originalsLayout}
${BROWSER_JOURNAL_LAYOUT}
PRAGMA user_version=3;
ALTER TABLE originals ADD COLUMN data TEXT CHECK(data IS NULL OR json_valid(data));
ALTER TABLE browser_attempts ADD COLUMN originalId TEXT;
${contextLayout}
${plansLayout}
${X_WARNING_LAYOUT}
${INSTAGRAM_WARNING_LAYOUT}
PRAGMA user_version=${SQLITE_LAYOUT_VERSION};
`;

export function storageError(error: unknown): Error {
  if (error instanceof CliError) return error;
  if (error && typeof error === 'object') {
    const code = 'code' in error ? error.code : undefined;
    const sqlite = 'errcode' in error ? error.errcode : undefined;
    if (typeof sqlite === 'number' && [5, 6].includes(sqlite & 255))
      return new CliError('WORKSPACE_BUSY');
    if (
      code === 'ENOSPC' ||
      (typeof sqlite === 'number' && (sqlite & 255) === 13)
    )
      return new CliError('STORAGE_FULL');
    if (typeof sqlite === 'number') {
      if ([1555, 2067].includes(sqlite))
        return new WorkspaceError('DUPLICATE_ID');
      return new WorkspaceError('STORAGE');
    }
  }
  return error instanceof Error ? error : new Error('STORAGE');
}

function parseRow<R>(row: Record<string, unknown> | undefined): R | undefined {
  if (!row) return undefined;
  if (typeof row.data !== 'string') throw new CliError('WORKSPACE_INVALID');
  return JSON.parse(row.data) as R;
}
function originalRow(
  row: Record<string, unknown> | undefined,
): Original | undefined {
  if (!row) return undefined;
  if (typeof row.data === 'string')
    return OriginalSchema.parse(JSON.parse(row.data));
  if (
    typeof row.photos !== 'string' ||
    (row.raw !== null && typeof row.raw !== 'string')
  )
    throw new CliError('WORKSPACE_INVALID');
  const { data: unused, ...legacy } = row;
  void unused;
  return migrateOriginal({
    ...legacy,
    photos: JSON.parse(row.photos) as unknown,
    raw: row.raw === null ? null : (JSON.parse(row.raw) as unknown),
  });
}

export interface SQLiteOpenOptions {
  initial?: WorkspaceV2;
  readOnly?: boolean;
}

/** Technology adapter only. Core owns merges, validation and review rules. */
export class SQLiteStore implements WorkspaceStore {
  private readonly db: DatabaseSync;
  private readonly path: string;
  private readonly readOnly: boolean;
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private pinned = false;
  private exclusive = false;
  private hasOriginals = true;
  private legacyContext: 5 | 6 | 7 | undefined;

  private constructor(db: DatabaseSync, path: string, readOnly: boolean) {
    this.db = db;
    this.path = path;
    this.readOnly = readOnly;
  }

  static async open(
    path: string,
    options: SQLiteOpenOptions = {},
  ): Promise<SQLiteStore> {
    requireWorkspaceNode(process.versions.node);
    // Type-only imports above do not load SQLite on unsupported Node or help paths.
    const { DatabaseSync } = await import('node:sqlite');
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path, {
        allowExtension: false,
        readOnly: Boolean(options.readOnly),
      });
      db.exec('PRAGMA busy_timeout=5000;');
      if (options.readOnly) {
        if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete')
          throw new CliError('WORKSPACE_INVALID');
      } else db.exec('PRAGMA journal_mode=DELETE;');
      db.exec(
        'PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;',
      );
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (
        !Number.isInteger(version) ||
        Number(version) < 0 ||
        Number(version) > SQLITE_LAYOUT_VERSION
      )
        throw new CliError('WORKSPACE_SCHEMA_UNSUPPORTED');
      const store = new SQLiteStore(db, path, Boolean(options.readOnly));
      store.legacyContext =
        options.readOnly && Number(version) >= 5 && Number(version) < 8
          ? (Number(version) as 5 | 6 | 7)
          : undefined;
      if (version === 0) {
        if (options.readOnly || !options.initial)
          throw new CliError('WORKSPACE_INVALID');
        await store.initialize(options.initial);
      }
      if (
        Number(version) > 0 &&
        Number(version) < SQLITE_LAYOUT_VERSION &&
        !options.readOnly
      ) {
        // Refuse unknown logical schemas before a physical migration can write.
        await store.read(async (tx) => tx.meta.get());
        db.exec('BEGIN EXCLUSIVE;');
        try {
          if (
            Number(db.prepare('PRAGMA user_version').get()?.user_version) <
            SQLITE_LAYOUT_VERSION
          ) {
            const stamp = new Date().toISOString().replaceAll(':', '-');
            await copyFile(
              path,
              `${path}.${stamp}-${crypto.randomUUID()}.before-migration.sqlite`,
              constants.COPYFILE_EXCL,
            );
            if (Number(version) < 4) {
              if (version === 1) db.exec(originalsLayout);
              db.exec('DROP TRIGGER IF EXISTS browser_runs_finish_once;');
              db.exec(BROWSER_JOURNAL_LAYOUT);
              db.exec('PRAGMA user_version=3;');
              if (
                !db
                  .prepare('PRAGMA table_info(originals)')
                  .all()
                  .some((column) => column.name === 'data')
              )
                db.exec(
                  'ALTER TABLE originals ADD COLUMN data TEXT CHECK(data IS NULL OR json_valid(data));',
                );
              if (
                !db
                  .prepare('PRAGMA table_info(browser_attempts)')
                  .all()
                  .some((column) => column.name === 'originalId')
              )
                db.exec(
                  'ALTER TABLE browser_attempts ADD COLUMN originalId TEXT;',
                );
              for (const row of db.prepare('SELECT * FROM originals').all()) {
                const original = originalRow(row)!;
                db.prepare('UPDATE originals SET data=? WHERE id=?').run(
                  JSON.stringify(original),
                  original.id,
                );
              }
            }
            if (
              Number(version) < 5 &&
              !db
                .prepare(
                  "SELECT name FROM sqlite_schema WHERE name='instagram_context'",
                )
                .get()
            )
              db.exec(contextLayout);
            if (Number(version) < 5) {
              db.exec('DROP TRIGGER IF EXISTS browser_runs_finish_once;');
              db.exec(BROWSER_JOURNAL_LAYOUT);
            }
            if (Number(version) < 6) {
              db.exec(`
                DROP TRIGGER instagram_context_no_update;
                DROP TRIGGER instagram_context_no_delete;
                UPDATE instagram_context SET data=json_set(data,'$.confirmedBy','post');
                CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END;
                CREATE TRIGGER instagram_context_no_delete BEFORE DELETE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END;
              `);
            }
            if (Number(version) < 8) {
              db.exec(
                'DROP TRIGGER instagram_context_no_update; DROP TRIGGER instagram_context_no_delete;',
              );
              for (const row of db
                .prepare('SELECT item_id, data FROM instagram_context')
                .all()) {
                const record = migrateInstagramContext(
                  JSON.parse(String(row.data)),
                  7,
                );
                db.prepare(
                  'UPDATE instagram_context SET data=? WHERE item_id=?',
                ).run(JSON.stringify(record), String(row.item_id));
              }
              db.exec(`
                CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END;
                CREATE TRIGGER instagram_context_no_delete BEFORE DELETE ON instagram_context BEGIN SELECT RAISE(ABORT,'write-once'); END;
              `);
            }
            const meta = JSON.parse(
              String(db.prepare('SELECT data FROM meta').get()!.data),
            ) as Record<string, unknown>;
            if (Number(version) < 7) {
              db.exec(plansLayout);
              const oldSettings = WorkspaceMetaSchema.parse(meta).settings;
              meta.settings = migrateReviewSettings(
                oldSettings,
                db
                  .prepare('SELECT data FROM assessments ORDER BY seq')
                  .all()
                  .map((row) =>
                    AssessmentSchema.parse(JSON.parse(String(row.data))),
                  ),
              );
              db.exec('DROP TRIGGER submissions_no_update;');
              for (const row of db
                .prepare('SELECT data FROM submissions')
                .all()) {
                const submission = migrateSubmission(
                  SubmissionSchema.parse(JSON.parse(String(row.data))),
                  oldSettings,
                );
                db.prepare(
                  'UPDATE submissions SET data=? WHERE submission_id=?',
                ).run(JSON.stringify(submission), submission.submissionId);
              }
              db.exec(
                "CREATE TRIGGER submissions_no_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT,'append-only'); END;",
              );
            }
            if (Number(version) < 9) db.exec(X_WARNING_LAYOUT);
            if (Number(version) < 10) {
              db.exec(INSTAGRAM_WARNING_LAYOUT);
              db.exec('DROP TRIGGER IF EXISTS browser_runs_finish_once;');
              db.exec(BROWSER_JOURNAL_LAYOUT);
            }
            db.prepare('UPDATE meta SET data=?').run(
              JSON.stringify({
                ...meta,
                schemaVersion: WORKSPACE_SCHEMA_VERSION,
              }),
            );
            if (Number(version) < 12)
              db.exec(`
              DROP TRIGGER instagram_context_no_update;
              CREATE TRIGGER instagram_context_no_update BEFORE UPDATE ON instagram_context WHEN
                json_extract(OLD.data,'$.confirmedBy')!='post' OR NOT (
                  (json_type(OLD.data,'$.likes') IS NULL AND json_type(NEW.data,'$.likes') IS 'object' AND json_remove(OLD.data,'$.likes')=json_remove(NEW.data,'$.likes')) OR
                  (json_type(OLD.data,'$.replies') IS NULL AND json_type(NEW.data,'$.replies') IS 'object' AND json_remove(OLD.data,'$.replies')=json_remove(NEW.data,'$.replies'))
                )
              BEGIN SELECT RAISE(ABORT,'write-once'); END;
            `);
            db.exec(`PRAGMA user_version=${SQLITE_LAYOUT_VERSION};`);
          }
          db.exec('COMMIT;');
        } catch (error) {
          db.exec('ROLLBACK;');
          throw error;
        }
      }
      store.hasOriginals = version !== 1 || !options.readOnly;
      await store.read(async (tx) => tx.meta.get());
      return store;
    } catch (error) {
      db?.close();
      throw storageError(error);
    }
  }

  private async initialize(input: WorkspaceV2): Promise<void> {
    const workspace = WorkspaceV2Schema.parse(input);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // Recheck after acquiring the lock: another importer may have initialized it.
      if (this.db.prepare('PRAGMA user_version').get()?.user_version !== 0) {
        this.db.exec('COMMIT;');
        return;
      }
      if (
        this.db
          .prepare("SELECT name FROM sqlite_schema WHERE type='table' LIMIT 1")
          .get()
      )
        throw new CliError('WORKSPACE_INVALID');
      this.db.exec(layout);
      const {
        counts: _counts,
        imports,
        items,
        submissions,
        assessments,
        decisionEvents,
        outcomeEvents,
        originals,
        browserRuns,
        browserAttempts,
        instagramContext,
        reviewPlans,
        ...meta
      } = workspace;
      void _counts;
      this.db
        .prepare('INSERT INTO meta VALUES (1, ?, 0, 0)')
        .run(JSON.stringify(meta));
      const { tx, expire } = this.transactionAccessors(true);
      try {
        for (const record of imports) await tx.imports.put(record);
        for (const item of items) {
          const importId = importForItem(item, imports);
          await tx.items.put({ item, importId, metadataImportId: importId });
        }
        for (const value of submissions) await tx.submissions.add(value);
        for (const value of reviewPlans ?? []) await tx.reviewPlans.add(value);
        for (const value of originals ?? []) await tx.originals.put(value);
        for (const value of browserRuns ?? []) await tx.browserRuns.add(value);
        for (const value of browserAttempts ?? [])
          await tx.browserAttempts.add(value);
        for (const value of instagramContext ?? [])
          await tx.instagramContext.add(value);
        await tx.assessments.append(assessments);
        await tx.decisionEvents.append(decisionEvents);
        await tx.outcomeEvents.append(outcomeEvents);
        for (const state of initialState(workspace)) await tx.state.put(state);
      } finally {
        expire();
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private transactionAccessors(writable: boolean): {
    tx: WriteTransaction;
    expire: () => void;
  } {
    const db = this.db;
    const hasOriginals = this.hasOriginals;
    const hasJournal = journalExists(db);
    const hasContext = Boolean(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name='instagram_context'",
        )
        .get(),
    );
    const hasPlans = Boolean(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE name='review_plans'")
        .get(),
    );
    let active = true;
    const guard = (write = false) => {
      if (!active || (write && (!writable || this.readOnly)))
        throw new WorkspaceError('STORAGE');
    };
    const run = (sql: string, ...values: SQLInputValue[]) => {
      guard(true);
      db.prepare(sql).run(...values);
    };
    const get = <R>(sql: string, ...values: SQLInputValue[]): R | undefined => {
      guard();
      return parseRow<R>(db.prepare(sql).get(...values));
    };
    const iterate = <R>(table: string, order = 'rowid') =>
      async function* (options?: IterationOptions): AsyncIterable<R> {
        await Promise.resolve();
        guard();
        const bounds = iterationBounds(options);
        let offset = bounds.offset;
        let remaining = bounds.limit;
        while (remaining) {
          guard();
          const amount = Math.min(1000, remaining);
          const rows = db
            .prepare(
              `SELECT data FROM ${table} ORDER BY ${order} LIMIT ? OFFSET ?`,
            )
            .all(amount, offset);
          if (!rows.length) return;
          for (const row of rows) {
            guard();
            yield parseRow<R>(row)!;
          }
          offset += rows.length;
          remaining -= rows.length;
          if (rows.length < amount) return;
        }
      };
    // Identifiers come only from these private, fixed table definitions.
    const table = <R>(
      name: string,
      keyColumn: string,
      key: (value: R) => string,
      validate: (value: R) => R,
      order?: string,
    ) => ({
      get: (id: string) =>
        Promise.resolve(
          get<R>(`SELECT data FROM ${name} WHERE ${keyColumn}=?`, id),
        ),
      iterate: iterate<R>(name, order),
      put(input: R) {
        guard(true);
        const value = validate(input);
        run(
          `INSERT INTO ${name} (${keyColumn}, data) VALUES (?, ?) ON CONFLICT (${keyColumn}) DO UPDATE SET data=excluded.data`,
          key(value),
          JSON.stringify(value),
        );
        return Promise.resolve();
      },
      add(input: R) {
        guard(true);
        const value = validate(input);
        run(
          `INSERT INTO ${name} (${keyColumn}, data) VALUES (?, ?)`,
          key(value),
          JSON.stringify(value),
        );
        return Promise.resolve();
      },
    });
    const runtime = (): WorkspaceRuntime => {
      guard();
      const row = db
        .prepare('SELECT revision, last_event_seq FROM meta WHERE singleton=1')
        .get();
      return {
        revision: Number(row?.revision ?? 0),
        lastEventSeq: Number(row?.last_event_seq ?? 0),
      };
    };
    const log = <R extends { itemId: string }>(
      name: string,
      keyColumn: string,
      key: (value: R) => string,
      validate: (value: R) => R,
      events = false,
    ): AppendWriter<R> => ({
      iterate: iterate<R>(name, 'seq'),
      append(inputs) {
        guard(true);
        let last = events
          ? Number(
              db.prepare(`SELECT max(seq) AS seq FROM ${name}`).get()?.seq ?? 0,
            )
          : 0;
        for (const input of inputs) {
          const value = validate(input);
          if (name === 'outcome_events') {
            const event = OutcomeEventSchema.parse(value);
            const state = get<StoredState>(
              'SELECT data FROM state WHERE item_id=?',
              event.itemId,
            );
            const prior = get<OutcomeEvent>(
              'SELECT data FROM outcome_events WHERE item_id=? ORDER BY seq DESC LIMIT 1',
              event.itemId,
            );
            const expectedVia = event.itemId.startsWith('instagram:')
              ? 'browser-instagram'
              : 'browser-x';
            if (
              (event.source.via === 'browser-instagram' &&
                !event.itemId.startsWith('instagram:')) ||
              (event.source.via === 'browser-x' &&
                !event.itemId.startsWith('x:'))
            )
              throw new CliError('OUTCOME_FINAL');
            if (state && prior?.value === 'deleted-via-browser') {
              const attempt = readJournal(db).attempts.find(
                (attempt) => attempt.attemptId === event.action.id,
              );
              if (
                event.value !== 'unknown' ||
                event.source.via !== expectedVia ||
                attempt?.state !== 'reappeared' ||
                attempt.itemId !== event.itemId
              )
                throw new CliError('OUTCOME_FINAL');
            }
            if (
              state &&
              event.value === 'deleted-via-browser' &&
              (event.source.via !== expectedVia ||
                readJournal(db).attempts.find(
                  (attempt) => attempt.attemptId === event.action.id,
                )?.state !== 'deleted')
            )
              throw new CliError('OUTCOME_FINAL');
          }
          if (events) {
            const seq = (value as R & { seq: number }).seq;
            if (
              seq <= last ||
              db.prepare('SELECT seq FROM event_sequences WHERE seq=?').get(seq)
            )
              throw new WorkspaceError('EVENT_SEQUENCE');
            run(
              'INSERT INTO event_sequences (seq, event_id) VALUES (?, ?)',
              seq,
              key(value),
            );
            run(
              `INSERT INTO ${name} (seq, ${keyColumn}, item_id, data) VALUES (?, ?, ?, ?)`,
              seq,
              key(value),
              value.itemId,
              JSON.stringify(value),
            );
            run(
              'UPDATE meta SET last_event_seq=max(last_event_seq, ?) WHERE singleton=1',
              seq,
            );
            last = seq;
          } else
            run(
              `INSERT INTO ${name} (${keyColumn}, item_id, data) VALUES (?, ?, ?)`,
              key(value),
              value.itemId,
              JSON.stringify(value),
            );
        }
        return Promise.resolve();
      },
    });
    const tx: WriteTransaction = {
      meta: {
        get: () => {
          const value = get<unknown>('SELECT data FROM meta WHERE singleton=1');
          if (
            value &&
            typeof value === 'object' &&
            'schemaVersion' in value &&
            typeof value.schemaVersion === 'number' &&
            value.schemaVersion > WORKSPACE_SCHEMA_VERSION
          )
            throw new CliError('WORKSPACE_SCHEMA_UNSUPPORTED');
          const result = WorkspaceMetaSchema.safeParse(value);
          if (!result.success) throw new CliError('WORKSPACE_INVALID');
          return Promise.resolve(
            this.legacyContext === 5
              ? { ...result.data, schemaVersion: 6 }
              : result.data,
          );
        },
        set(value) {
          guard(true);
          run(
            'UPDATE meta SET data=? WHERE singleton=1',
            JSON.stringify(WorkspaceMetaSchema.parse(value)),
          );
          return Promise.resolve();
        },
      },
      runtime: {
        get: () => Promise.resolve(runtime()),
        set(value) {
          const before = runtime();
          const last = value.lastEventSeq ?? before.lastEventSeq;
          if (
            !Number.isSafeInteger(value.revision) ||
            value.revision < before.revision ||
            !Number.isSafeInteger(last) ||
            last < before.lastEventSeq
          )
            throw new WorkspaceError('STORAGE');
          run(
            'UPDATE meta SET revision=?, last_event_seq=? WHERE singleton=1',
            value.revision,
            last,
          );
          return Promise.resolve();
        },
      },
      commands: table<CommandReceipt>(
        'commands',
        'command_id',
        (value) => value.commandId,
        (value) => value,
      ),
      imports: table(
        'imports',
        'id',
        (value) => value.id,
        (value) => ImportRecordSchema.parse(value),
      ),
      items: {
        get: (id) =>
          Promise.resolve(
            get<StoredItem>('SELECT data FROM items WHERE id=?', id),
          ),
        iterate: iterate<StoredItem>('items'),
        put(input) {
          guard(true);
          const value = { ...input, item: ItemSchema.parse(input.item) };
          run(
            `INSERT INTO items (id, import_id, metadata_import_id, likes, reposts, data) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET import_id=excluded.import_id, metadata_import_id=excluded.metadata_import_id,
              likes=excluded.likes, reposts=excluded.reposts, data=excluded.data`,
            value.item.id,
            value.importId,
            value.metadataImportId,
            value.item.engagement.likes,
            value.item.engagement.reposts,
            JSON.stringify(value),
          );
          return Promise.resolve();
        },
      },
      originals: {
        get: (id) => {
          guard();
          return Promise.resolve(
            this.hasOriginals
              ? originalRow(
                  db.prepare('SELECT * FROM originals WHERE id=?').get(id),
                )
              : undefined,
          );
        },
        iterate: async function* (options) {
          await Promise.resolve();
          guard();
          const { offset, limit } = iterationBounds(options);
          if (!hasOriginals) return;
          for (
            let position = offset;
            position < offset + limit;
            position += 1000
          ) {
            guard();
            const rows = db
              .prepare('SELECT * FROM originals ORDER BY id LIMIT ? OFFSET ?')
              .all(Math.min(1000, offset + limit - position), position);
            for (const row of rows) {
              guard();
              yield originalRow(row)!;
            }
            if (rows.length < 1000) break;
          }
        },
        put: (input) => {
          guard(true);
          const value = migrateOriginal(input);
          validateOriginal(value);
          run(
            `INSERT INTO originals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status=excluded.status, fetchedAt=excluded.fetchedAt, text=excluded.text,
            authorName=excluded.authorName, authorHandle=excluded.authorHandle, photos=excluded.photos,
            quotedId=excluded.quotedId, parentId=excluded.parentId, raw=excluded.raw,
            textCompleteness=excluded.textCompleteness, video=excluded.video,data=excluded.data`,
            value.id,
            value.anonymous?.status ?? 'failed',
            value.anonymous?.at ??
              value.signedIn?.at ??
              new Date().toISOString(),
            value.text,
            value.authorName,
            value.authorHandle,
            '[]',
            value.quotedId,
            value.parentId,
            value.raw === null ? null : JSON.stringify(value.raw),
            value.textCompleteness === 'full'
              ? 'unknown'
              : value.textCompleteness,
            null,
            JSON.stringify(value),
          );
          return Promise.resolve();
        },
      },
      instagramContext: {
        fillReplies: (value) => {
          const prior = get<InstagramContext>(
            'SELECT data FROM instagram_context WHERE item_id=?',
            value.itemId,
          );
          if (!prior) throw new Error('INVALID_CONTEXT_RECORD');
          validateInstagramRepliesFill(prior, value);
          run(
            "UPDATE instagram_context SET data=json_set(data,'$.replies',json(?)) WHERE item_id=?",
            JSON.stringify(value.replies),
            value.itemId,
          );
          return Promise.resolve();
        },
        fillLikes: (value) => {
          const prior = get<InstagramContext>(
            'SELECT data FROM instagram_context WHERE item_id=?',
            value.itemId,
          );
          if (!prior) throw new Error('INVALID_CONTEXT_RECORD');
          validateInstagramLikesFill(prior, value);
          // Preserve stored key ordering as well as all confirmation fields.
          run(
            "UPDATE instagram_context SET data=json_set(data,'$.likes',json(?)) WHERE item_id=?",
            JSON.stringify(value.likes),
            value.itemId,
          );
          return Promise.resolve();
        },
        get: (id) => {
          const value = hasContext
            ? get<unknown>(
                'SELECT data FROM instagram_context WHERE item_id=?',
                id,
              )
            : undefined;
          return Promise.resolve(
            value === undefined
              ? undefined
              : this.legacyContext
                ? migrateInstagramContext(value, this.legacyContext)
                : InstagramContextSchema.parse(value),
          );
        },
        iterate: (options) => {
          const legacy = this.legacyContext;
          return (async function* () {
            guard();
            if (!hasContext) return;
            for await (const value of iterate<unknown>('instagram_context')(
              options,
            ))
              yield legacy
                ? migrateInstagramContext(value, legacy)
                : InstagramContextSchema.parse(value);
          })();
        },
        add: (value) =>
          table<InstagramContext>(
            'instagram_context',
            'item_id',
            (record) => record.itemId,
            (record) => InstagramContextSchema.parse(record),
          ).add(value),
      },
      browserRuns: {
        get: (id) =>
          Promise.resolve(
            hasJournal
              ? get<BrowserRun>(
                  'SELECT data FROM browser_runs WHERE run_id=?',
                  id,
                )
              : undefined,
          ),
        iterate: hasJournal
          ? iterate<BrowserRun>('browser_runs')
          : async function* () {
              await Promise.resolve();
              guard();
            },
        async add(input) {
          guard(true);
          const value = BrowserRunSchema.parse(input);
          run(
            'INSERT INTO browser_runs VALUES(?,?,?,?)',
            value.runId,
            value.accountKey,
            value.endedAt,
            JSON.stringify(value),
          );
          await Promise.resolve();
        },
        async put(input) {
          guard(true);
          const value = BrowserRunSchema.parse(input);
          const prior = get<BrowserRun>(
            'SELECT data FROM browser_runs WHERE run_id=?',
            value.runId,
          );
          if (!prior) throw new CliError('WORKSPACE_INVALID');
          validateBrowserRunUpdate(prior, value);
          run(
            'UPDATE browser_runs SET ended_at=?,data=? WHERE run_id=?',
            value.endedAt,
            JSON.stringify(value),
            value.runId,
          );
          await Promise.resolve();
        },
      },
      browserAttempts: {
        get: (id) =>
          Promise.resolve(
            hasJournal
              ? get<BrowserAttempt>(
                  'SELECT data FROM browser_attempts WHERE attempt_id=?',
                  id,
                )
              : undefined,
          ),
        iterate: hasJournal
          ? iterate<BrowserAttempt>('browser_attempts', 'seq')
          : async function* () {
              await Promise.resolve();
              guard();
            },
        async add(input) {
          guard(true);
          const value = BrowserAttemptSchema.parse(input);
          if (
            Number(
              db
                .prepare(
                  'SELECT coalesce(max(seq),0) AS seq FROM browser_attempts',
                )
                .get()!.seq,
            ) >= value.seq
          )
            throw new WorkspaceError('EVENT_SEQUENCE');
          run(
            'INSERT INTO browser_attempts(seq,attempt_id,run_id,item_id,state,settles,data,originalId) VALUES(?,?,?,?,?,?,?,?)',
            value.seq,
            value.attemptId,
            value.runId,
            value.itemId ?? '',
            value.state,
            value.settles,
            JSON.stringify(value),
            value.originalId ?? null,
          );
          await Promise.resolve();
        },
      },
      submissions: table(
        'submissions',
        'submission_id',
        (value) => value.submissionId,
        (value) =>
          migrateSubmission(
            SubmissionSchema.parse(value),
            WorkspaceMetaSchema.parse(
              get<unknown>('SELECT data FROM meta WHERE singleton=1'),
            ).settings,
          ),
      ),
      reviewPlans: {
        ...table(
          'review_plans',
          'action_id',
          (value: import('@socialprune/core').ReviewPlan) => value.actionId,
          (value) => ReviewPlanSchema.parse(value),
        ),
        iterate: hasPlans
          ? iterate<import('@socialprune/core').ReviewPlan>('review_plans')
          : async function* () {
              await Promise.resolve();
              guard();
            },
        get: (id) =>
          Promise.resolve(
            hasPlans
              ? get<import('@socialprune/core').ReviewPlan>(
                  'SELECT data FROM review_plans WHERE action_id=?',
                  id,
                )
              : undefined,
          ),
      },
      assessments: log(
        'assessments',
        'assessment_id',
        (value) => value.assessmentId,
        (value) => AssessmentSchema.parse(value),
      ),
      decisionEvents: log(
        'decision_events',
        'event_id',
        (value) => value.eventId,
        (value) => DecisionEventSchema.parse(value),
        true,
      ),
      outcomeEvents: log(
        'outcome_events',
        'event_id',
        (value) => value.eventId,
        (value) => OutcomeEventSchema.parse(value),
        true,
      ),
      state: table<StoredState>(
        'state',
        'item_id',
        (value) => value.itemId,
        (value) => value,
      ),
      migrationEvents: {
        get: (id) =>
          Promise.resolve(
            get<MigrationEvent>(
              'SELECT data FROM migration_events WHERE id=?',
              id,
            ),
          ),
        iterate: iterate<MigrationEvent>(
          'migration_events',
          'timestamp, kind_order, array_index',
        ),
        add(value) {
          run(
            'INSERT INTO migration_events VALUES (?, ?, ?, ?, ?)',
            value.id,
            Date.parse(value.at),
            value.kind === 'decision' ? 0 : 1,
            value.index,
            JSON.stringify(value),
          );
          return Promise.resolve();
        },
        remove(id) {
          run('DELETE FROM migration_events WHERE id=?', id);
          return Promise.resolve();
        },
        clear() {
          run('DELETE FROM migration_events');
          return Promise.resolve();
        },
      },
    };
    return {
      tx,
      expire: () => {
        active = false;
      },
    };
  }

  private transact<T>(
    writable: boolean,
    operation: (tx: WriteTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.closing || (writable && this.readOnly))
      return Promise.reject(new WorkspaceError('STORAGE'));
    const result = this.queue.then(async () => {
      const begin = !this.pinned;
      try {
        if (begin) this.db.exec(writable ? 'BEGIN IMMEDIATE;' : 'BEGIN;');
        const { tx, expire } = this.transactionAccessors(writable);
        try {
          const value = await operation(tx);
          if (begin) this.db.exec('COMMIT;');
          return value;
        } catch (error) {
          if (begin) this.db.exec('ROLLBACK;');
          throw error;
        } finally {
          expire();
        }
      } catch (error) {
        throw storageError(error);
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  read<T>(operation: (tx: ReadTransaction) => Promise<T>): Promise<T> {
    return this.transact(false, operation);
  }
  write<T>(operation: (tx: WriteTransaction) => Promise<T>): Promise<T> {
    return this.transact(true, operation);
  }

  browserJournal() {
    return this.read(async () => {
      await Promise.resolve();
      return readJournal(this.db);
    });
  }

  browserOutcomeWriter(): BrowserOutcomeWriter {
    if (this.readOnly) throw new CliError('WORKSPACE_INVALID');
    return new BrowserOutcomeWriter(this.db, (operation) =>
      this.write(operation),
    );
  }

  /** Core's paged writer gets one SQLite read transaction, not independent snapshots. */
  async snapshot(): Promise<{ store: WorkspaceStore; close(): Promise<void> }> {
    const reader = await SQLiteStore.open(this.path, { readOnly: true });
    try {
      reader.db.exec('BEGIN;');
      reader.pinned = true;
      reader.db.prepare('SELECT data FROM meta WHERE singleton=1').get();
    } catch (error) {
      await reader.close();
      throw storageError(error);
    }
    let released = false;
    return {
      store: {
        read: (operation) =>
          released ? this.read(operation) : reader.read(operation),
        write: (operation) => this.write(operation),
        close: () => reader.close(),
      },
      close: async () => {
        await reader.close();
        released = true;
      },
    };
  }

  /** Restore checks this lock before any active-file rename. No lock-file convention. */
  async checkExclusive(): Promise<void> {
    await this.queue;
    try {
      this.db.exec('BEGIN EXCLUSIVE;');
      this.exclusive = true;
    } catch (error) {
      throw storageError(error);
    }
  }

  async close(): Promise<void> {
    if (this.closing) {
      await this.queue;
      return;
    }
    this.closing = true;
    await this.queue;
    if (this.pinned || this.exclusive) this.db.exec('ROLLBACK;');
    this.db.close();
  }
}
