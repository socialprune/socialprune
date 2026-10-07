import { openDB, unwrap } from 'idb';
import type { IDBPDatabase } from 'idb';
import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  WorkspaceMetaSchema,
} from '@socialprune/core';
import type { WorkspaceV2, WorkspaceMeta } from '@socialprune/core';
import {
  createWorkspace,
  initialState,
  importForItem,
  iterationBounds,
} from '@socialprune/core/workspace/store';
import type {
  WorkspaceStore,
  WriteTransaction,
  ReadTransaction,
  StoredItem,
  WorkspaceRuntime,
  MigrationEvent,
} from '@socialprune/core/workspace/store';

const TABLES = [
  'meta',
  'runtime',
  'commands',
  'imports',
  'items',
  'submissions',
  'assessments',
  'decisionEvents',
  'outcomeEvents',
  'state',
  'eventSequences',
  'migrationEvents',
] as const;
export type StorageLifecycle = 'blocked' | 'versionchange' | 'terminated';
const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error('IndexedDB request failed.'));
  });

export class IndexedDBStore implements WorkspaceStore {
  private closed = false;
  private readonly database: IDBPDatabase;
  private constructor(database: IDBPDatabase) {
    this.database = database;
  }

  static async open(
    workspaceId: string,
    initial: WorkspaceV2 = createWorkspace({ id: workspaceId }),
    onLifecycle: (state: StorageLifecycle) => void = () => {},
  ): Promise<IndexedDBStore> {
    const db = await openDB(`sp-ws-${workspaceId}`, 1, {
      upgrade(db) {
        db.createObjectStore('meta');
        db.createObjectStore('runtime');
        db.createObjectStore('commands', { keyPath: 'commandId' });
        db.createObjectStore('imports', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'item.id' }).createIndex(
          'importId',
          'importId',
        );
        db.createObjectStore('submissions', { keyPath: 'submissionId' });
        const assessments = db.createObjectStore('assessments', {
          autoIncrement: true,
        });
        assessments.createIndex('assessmentId', 'assessmentId', {
          unique: true,
        });
        assessments.createIndex('itemId', 'itemId');
        for (const name of ['decisionEvents', 'outcomeEvents'] as const) {
          const log = db.createObjectStore(name, { autoIncrement: true });
          log.createIndex('eventId', 'eventId', { unique: true });
          log.createIndex('itemId', 'itemId');
        }
        db.createObjectStore('state', { keyPath: 'itemId' });
        db.createObjectStore('eventSequences', { keyPath: 'seq' });
        const migration = db.createObjectStore('migrationEvents', {
          keyPath: 'id',
        });
        migration.createIndex('order', ['timestamp', 'kindOrder', 'index']);
      },
      blocked() {
        onLifecycle('blocked');
      },
      blocking() {
        db.close();
        onLifecycle('versionchange');
      },
      terminated() {
        onLifecycle('terminated');
      },
    });
    const store = new IndexedDBStore(db);
    if (!(await db.get('meta', 'workspace'))) await store.initialize(initial);
    return store;
  }

  private async initialize(workspace: WorkspaceV2) {
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
    await this.write(async (tx) => {
      await tx.meta.set(meta);
      await tx.runtime.set({ revision: 0 });
      for (const record of imports) await tx.imports.put(record);
      for (const item of items) {
        const importId = importForItem(item, imports);
        await tx.items.put({ item, importId, metadataImportId: importId });
      }
      for (const record of submissions) await tx.submissions.add(record);
      await tx.assessments.append(assessments);
      await tx.decisionEvents.append(decisionEvents);
      await tx.outcomeEvents.append(outcomeEvents);
      for (const state of initialState(workspace)) await tx.state.put(state);
    });
  }

  read<T>(operation: (tx: ReadTransaction) => Promise<T>) {
    return this.transact(false, operation);
  }
  write<T>(operation: (tx: WriteTransaction) => Promise<T>) {
    return this.transact(true, operation);
  }

  private async transact<T>(
    writable: boolean,
    operation: (tx: WriteTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error('IndexedDB store closed.');
    const wrapped = this.database.transaction(
      [...TABLES],
      writable ? 'readwrite' : 'readonly',
      { durability: writable ? 'strict' : 'default' },
    );
    const done = wrapped.done;
    // Keep rejection observed even if the callback itself rejects first.
    void done.catch(() => undefined);
    const native = unwrap(wrapped);
    let active = true;
    const guard = (write = false) => {
      if (!active || (write && !writable))
        throw new Error('Expired or read-only transaction.');
    };
    const table = <R>(
      name: (typeof TABLES)[number],
      validate: (value: R) => R,
    ) => ({
      async get(id: string): Promise<R | undefined> {
        guard();
        return (await request(native.objectStore(name).get(id))) as
          R | undefined;
      },
      async *iterate(
        this: void,
        options?: { offset?: number; limit?: number },
      ): AsyncIterable<R> {
        guard();
        const { offset, limit } = iterationBounds(options);
        if (!limit) return;
        const store = native.objectStore(name);
        const source =
          name === 'migrationEvents' ? store.index('order') : store;
        if (name !== 'migrationEvents') {
          let range: IDBKeyRange | undefined;
          let skip = offset;
          let remaining = limit;
          while (remaining > 0) {
            guard();
            const amount = Math.min(1000, remaining + Math.min(skip, 1000));
            const valuesRequest = source.getAll(range, amount);
            const keysRequest = source.getAllKeys(range, amount);
            const values = (await request(valuesRequest)) as R[];
            const keys = await request(keysRequest);
            if (!values.length) return;
            range = IDBKeyRange.lowerBound(keys.at(-1)!, true);
            for (const value of values) {
              if (skip) {
                skip--;
                continue;
              }
              if (!remaining--) return;
              yield await Promise.resolve(value);
            }
          }
          return;
        }
        const cursorRequest = source.openCursor();
        let cursor = await request(cursorRequest);
        if (cursor && offset) {
          cursor.advance(offset);
          cursor = await request(cursorRequest);
        }
        for (let count = 0; cursor && count < limit; count++) {
          guard();
          const value = cursor.value as R & {
            timestamp?: number;
            kindOrder?: number;
          };
          if (name === 'migrationEvents') {
            delete value.timestamp;
            delete value.kindOrder;
          }
          yield await Promise.resolve(value);
          guard();
          cursor.continue();
          cursor = await request(cursorRequest);
        }
      },
      async put(value: R) {
        guard(true);
        await request(native.objectStore(name).put(validate(value)));
      },
      async add(value: R) {
        guard(true);
        await request(native.objectStore(name).add(validate(value)));
      },
    });
    const log = <R>(
      name: 'assessments' | 'decisionEvents' | 'outcomeEvents',
      validate: (value: R) => R,
    ) => ({
      iterate: table<R>(name, validate).iterate,
      async append(values: readonly R[]) {
        guard(true);
        let last = 0;
        if (name !== 'assessments') {
          const cursor = await request(
            native.objectStore(name).openCursor(undefined, 'prev'),
          );
          last = cursor ? (cursor.value as { seq: number }).seq : 0;
        }
        for (const value of values) {
          const parsed = validate(value);
          if (name !== 'assessments') {
            const event = parsed as { seq: number };
            if (event.seq <= last) throw new Error('EVENT_SEQUENCE');
            await request(
              native.objectStore('eventSequences').add({ seq: event.seq }),
            );
            const runtime = (await request(
              native.objectStore('runtime').get('runtime'),
            )) as WorkspaceRuntime;
            await request(
              native.objectStore('runtime').put(
                {
                  ...runtime,
                  lastEventSeq: Math.max(runtime.lastEventSeq, event.seq),
                },
                'runtime',
              ),
            );
            last = event.seq;
          }
          await request(native.objectStore(name).add(parsed));
        }
      },
    });
    const tx: WriteTransaction = {
      meta: {
        async get() {
          guard();
          return (await request(
            native.objectStore('meta').get('workspace'),
          )) as WorkspaceMeta;
        },
        async set(value) {
          guard(true);
          await request(
            native
              .objectStore('meta')
              .put(WorkspaceMetaSchema.parse(value), 'workspace'),
          );
        },
      },
      runtime: {
        async get() {
          guard();
          return (
            ((await request(
              native.objectStore('runtime').get('runtime'),
            )) as WorkspaceRuntime) ?? { revision: 0, lastEventSeq: 0 }
          );
        },
        async set(value) {
          guard(true);
          const prior = (await request(
            native.objectStore('runtime').get('runtime'),
          )) as WorkspaceRuntime | undefined;
          if (
            !Number.isSafeInteger(value.revision) ||
            value.revision < (prior?.revision ?? 0)
          )
            throw new Error('Invalid revision.');
          if (
            value.lastEventSeq !== undefined &&
            (!Number.isSafeInteger(value.lastEventSeq) ||
              value.lastEventSeq < (prior?.lastEventSeq ?? 0))
          )
            throw new Error('EVENT_SEQUENCE');
          await request(
            native.objectStore('runtime').put(
              {
                revision: value.revision,
                lastEventSeq: value.lastEventSeq ?? prior?.lastEventSeq ?? 0,
              },
              'runtime',
            ),
          );
        },
      },
      commands: table('commands', (value) => value),
      imports: table('imports', (value) => ImportRecordSchema.parse(value)),
      items: table<StoredItem>('items', (value) => ({
        ...value,
        item: ItemSchema.parse(value.item),
      })),
      submissions: table('submissions', (value) =>
        SubmissionSchema.parse(value),
      ),
      assessments: log('assessments', (value) => AssessmentSchema.parse(value)),
      decisionEvents: log('decisionEvents', (value) =>
        DecisionEventSchema.parse(value),
      ),
      outcomeEvents: log('outcomeEvents', (value) =>
        OutcomeEventSchema.parse(value),
      ),
      state: table('state', (value) => value),
      migrationEvents: {
        ...table<MigrationEvent>('migrationEvents', (value) => ({
          ...value,
          timestamp: Date.parse(value.at),
          kindOrder: value.kind === 'decision' ? 0 : 1,
        })),
        async remove(id) {
          guard(true);
          await request(native.objectStore('migrationEvents').delete(id));
        },
        async clear() {
          guard(true);
          await request(native.objectStore('migrationEvents').clear());
        },
      },
    };
    try {
      const result = await operation(tx);
      active = false;
      await done;
      return result;
    } catch (error) {
      active = false;
      try {
        native.abort();
      } catch {
        /* Already aborted by an IndexedDB error. */
      }
      await done.catch(() => undefined);
      throw error;
    }
  }

  // The production bulk path unwraps just the requests, awaiting the one
  // atomic transaction rather than making one promise for every item put.
  async putItemBatch(
    items: readonly StoredItem[],
    preserveExisting = false,
  ): Promise<{ added: number; conflicts: number }> {
    if (items.length > 1000 || this.closed)
      throw new Error('Invalid item batch.');
    const tx = this.database.transaction(
      ['items', 'state', 'imports'],
      'readwrite',
    );
    const native = unwrap(tx);
    let added = 0,
      conflicts = 0;
    for (const record of items) {
      const prior = preserveExisting
        ? ((await request(native.objectStore('items').get(record.item.id))) as
            StoredItem | undefined)
        : undefined;
      if (prior) {
        if (
          prior.item.text !== record.item.text ||
          prior.item.createdAt !== record.item.createdAt ||
          prior.item.kind !== record.item.kind
        ) {
          conflicts++;
          continue;
        }
        const owner = (await request(
          native.objectStore('imports').get(prior.importId),
        )) as { status: string } | undefined;
        native.objectStore('items').put({
          ...record,
          importId:
            owner?.status === 'complete' ? prior.importId : record.importId,
          item: {
            ...prior.item,
            engagement: record.item.engagement,
            mediaCount: record.item.mediaCount,
            url: record.item.url,
            reference: record.item.reference,
            provenance: record.item.provenance,
          },
        });
      } else {
        native.objectStore('items').put(record);
        native.objectStore('state').put({
          itemId: record.item.id,
          decision: 'undecided',
          outcome: 'unknown',
        });
        added++;
      }
    }
    await tx.done;
    return { added, conflicts };
  }

  async discardIncomplete(importIds: readonly string[]): Promise<void> {
    const tx = this.database.transaction(
      ['items', 'state', 'imports'],
      'readwrite',
    );
    const native = unwrap(tx);
    const items = native.objectStore('items');
    for (const id of importIds) {
      while (true) {
        const keys = await request(
          items.index('importId').getAllKeys(IDBKeyRange.only(id), 1000),
        );
        if (!keys.length) break;
        for (const key of keys) {
          items.delete(key);
          native.objectStore('state').delete(key);
        }
      }
      native.objectStore('imports').delete(id);
    }
    await tx.done;
  }

  close(): Promise<void> {
    this.closed = true;
    this.database.close();
    return Promise.resolve();
  }
}

export async function deleteWorkspaceDatabase(id: string): Promise<void> {
  await request(indexedDB.deleteDatabase(`sp-ws-${id}`));
}
