import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  WorkspaceMetaSchema,
  WorkspaceV2Schema,
} from '@socialprune/core';
import type { WorkspaceV2 } from '@socialprune/core';
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

export const SQLITE_LAYOUT_VERSION = 1;

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
PRAGMA user_version=1;
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
      if (version !== 0 && version !== SQLITE_LAYOUT_VERSION)
        throw new CliError('WORKSPACE_SCHEMA_UNSUPPORTED');
      const store = new SQLiteStore(db, path, Boolean(options.readOnly));
      if (version === 0) {
        if (options.readOnly || !options.initial)
          throw new CliError('WORKSPACE_INVALID');
        await store.initialize(options.initial);
      }
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
        get() {
          const value = get<unknown>('SELECT data FROM meta WHERE singleton=1');
          if (
            value &&
            typeof value === 'object' &&
            'schemaVersion' in value &&
            typeof value.schemaVersion === 'number' &&
            value.schemaVersion > 2
          )
            throw new CliError('WORKSPACE_SCHEMA_UNSUPPORTED');
          const result = WorkspaceMetaSchema.safeParse(value);
          if (!result.success) throw new CliError('WORKSPACE_INVALID');
          return Promise.resolve(result.data);
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
      submissions: table(
        'submissions',
        'submission_id',
        (value) => value.submissionId,
        (value) => SubmissionSchema.parse(value),
      ),
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
