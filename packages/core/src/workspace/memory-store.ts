import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  WorkspaceMetaSchema,
} from '../model/index.ts';
import type {
  WorkspaceV2,
  DecisionEvent,
  OutcomeEvent,
} from '../model/index.ts';
import { WorkspaceError } from './errors.ts';
import {
  createWorkspace,
  importForItem,
  initialState,
  iterationBounds,
} from './store.ts';
import type {
  AppendWriter,
  CommandReceipt,
  RecordWriter,
  StoredItem,
  StoredState,
  UniqueWriter,
  WorkspaceRuntime,
  MigrationEvent,
  WorkspaceStore,
  WriteTransaction,
} from './store.ts';
import { validateWorkspace } from './validation.ts';

function database(workspace: WorkspaceV2) {
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
  return {
    meta,
    runtime: {
      revision: 0,
      lastEventSeq: [...decisionEvents, ...outcomeEvents].reduce(
        (maximum, event) => Math.max(maximum, event.seq),
        0,
      ),
    } satisfies WorkspaceRuntime,
    sequences: new Set(
      [...decisionEvents, ...outcomeEvents].map((event) => event.seq),
    ),
    migrationEvents: new Map<string, MigrationEvent>(),
    commands: new Map<string, CommandReceipt>(),
    imports: new Map(imports.map((record) => [record.id, record])),
    items: new Map<string, StoredItem>(
      items.map((item) => {
        const importId = importForItem(item, imports);
        return [item.id, { item, importId, metadataImportId: importId }];
      }),
    ),
    submissions: new Map(
      submissions.map((record) => [record.submissionId, record]),
    ),
    assessments: [...assessments],
    decisionEvents: [...decisionEvents],
    outcomeEvents: [...outcomeEvents],
    state: new Map(
      initialState(workspace).map((record) => [record.itemId, record]),
    ),
  };
}
type Database = ReturnType<typeof database>;

/** Shared backing lets tests close and reopen handles without losing commits. */
export class MemoryStoreBacking {
  current: Database;
  queue: Promise<unknown> = Promise.resolve();
  constructor(workspace: WorkspaceV2 = createWorkspace()) {
    this.current = database(validateWorkspace(workspace));
  }
}
function fork(source: Database): Database {
  return {
    ...source,
    imports: new Map(source.imports),
    items: new Map(source.items),
    submissions: new Map(source.submissions),
    commands: new Map(source.commands),
    state: new Map(source.state),
    sequences: new Set(source.sequences),
    migrationEvents: new Map(source.migrationEvents),
    assessments: [...source.assessments],
    decisionEvents: [...source.decisionEvents],
    outcomeEvents: [...source.outcomeEvents],
  };
}

export function createMemoryStore(
  backing: MemoryStoreBacking = new MemoryStoreBacking(),
): WorkspaceStore {
  let closed = false;
  const iterationCache = new WeakMap<
    object,
    { offset: number; iterator: Iterator<unknown> }
  >();
  const transact = <T>(
    writable: boolean,
    operation: (tx: WriteTransaction) => Promise<T>,
  ): Promise<T> => {
    if (closed) return Promise.reject(new WorkspaceError('STORAGE'));
    const run = async (): Promise<T> => {
      const db = writable ? fork(backing.current) : backing.current;
      let active = true;
      const guard = (write = false) => {
        if (!active || (write && !writable))
          throw new WorkspaceError('STORAGE');
      };
      const table = <R>(
        map: Map<string, R>,
        key: (record: R) => string,
        validate: (record: R) => R,
      ): RecordWriter<R> & UniqueWriter<R> => ({
        get(id) {
          guard();
          return Promise.resolve(structuredClone(map.get(id)));
        },
        async *iterate(options) {
          await Promise.resolve();
          guard();
          const { offset, limit } = iterationBounds(options);
          let position = options ? iterationCache.get(map) : undefined;
          if (!position || position.offset !== offset) {
            position = { offset: 0, iterator: map.values() };
            while (position.offset < offset) {
              if (position.iterator.next().done) break;
              position.offset++;
            }
            if (options) iterationCache.set(map, position);
          }
          for (let count = 0; count < limit; count++) {
            guard();
            const next = position.iterator.next();
            if (next.done) break;
            position.offset++;
            yield structuredClone(next.value as R);
          }
        },
        put(record) {
          guard(true);
          const value = validate(record);
          map.set(key(value), structuredClone(value));
          iterationCache.delete(map);
          return Promise.resolve();
        },
        add(record) {
          guard(true);
          const value = validate(record);
          if (map.has(key(value))) throw new WorkspaceError('DUPLICATE_ID');
          map.set(key(value), structuredClone(value));
          iterationCache.delete(map);
          return Promise.resolve();
        },
      });
      const log = <R>(
        array: R[],
        key: (record: R) => string,
        validate: (record: R) => R,
        eventLog = false,
      ): AppendWriter<R> => ({
        async *iterate(options) {
          await Promise.resolve();
          guard();
          const { offset, limit } = iterationBounds(options);
          for (
            let index = offset;
            index < array.length && index < offset + limit;
            index++
          ) {
            guard();
            yield structuredClone(array[index]!);
          }
        },
        append(records) {
          guard(true);
          const known = new Set(array.map(key));
          const values = records.map(validate);
          let lastSeq =
            eventLog && array.length
              ? (array.at(-1) as DecisionEvent | OutcomeEvent).seq
              : 0;
          const batchSeq = new Set<number>();
          for (const value of values) {
            if (known.has(key(value))) throw new WorkspaceError('DUPLICATE_ID');
            known.add(key(value));
            if (eventLog) {
              const seq = (value as DecisionEvent | OutcomeEvent).seq;
              if (seq <= lastSeq || db.sequences.has(seq) || batchSeq.has(seq))
                throw new WorkspaceError('EVENT_SEQUENCE');
              batchSeq.add(seq);
              lastSeq = seq;
            }
          }
          array.push(...structuredClone(values));
          for (const seq of batchSeq) {
            db.sequences.add(seq);
            db.runtime = {
              ...db.runtime,
              lastEventSeq: Math.max(db.runtime.lastEventSeq, seq),
            };
          }
          return Promise.resolve();
        },
      });
      const tx: WriteTransaction = {
        meta: {
          get() {
            guard();
            return Promise.resolve(structuredClone(db.meta));
          },
          set(value) {
            guard(true);
            db.meta = WorkspaceMetaSchema.parse(value);
            return Promise.resolve();
          },
        },
        runtime: {
          get() {
            guard();
            return Promise.resolve(structuredClone(db.runtime));
          },
          set(value) {
            guard(true);
            if (
              !Number.isSafeInteger(value.revision) ||
              value.revision < db.runtime.revision
            )
              throw new WorkspaceError('STORAGE');
            const lastEventSeq = value.lastEventSeq ?? db.runtime.lastEventSeq;
            if (
              !Number.isSafeInteger(lastEventSeq) ||
              lastEventSeq < db.runtime.lastEventSeq
            )
              throw new WorkspaceError('EVENT_SEQUENCE');
            db.runtime = { revision: value.revision, lastEventSeq };
            return Promise.resolve();
          },
        },
        commands: table(
          db.commands,
          (record) => record.commandId,
          (record) => record,
        ),
        imports: table(
          db.imports,
          (record) => record.id,
          (record) => ImportRecordSchema.parse(record),
        ),
        items: table(
          db.items,
          (record) => record.item.id,
          (record) => ({ ...record, item: ItemSchema.parse(record.item) }),
        ),
        submissions: table(
          db.submissions,
          (record) => record.submissionId,
          (record) => SubmissionSchema.parse(record),
        ),
        assessments: log(
          db.assessments,
          (record) => record.assessmentId,
          (record) => AssessmentSchema.parse(record),
        ),
        decisionEvents: log(
          db.decisionEvents,
          (record) => record.eventId,
          (record) => DecisionEventSchema.parse(record),
          true,
        ),
        outcomeEvents: log(
          db.outcomeEvents,
          (record) => record.eventId,
          (record) => OutcomeEventSchema.parse(record),
          true,
        ),
        state: table(
          db.state,
          (record) => record.itemId,
          (record: StoredState) => record,
        ),
        migrationEvents: {
          ...table(
            db.migrationEvents,
            (record) => record.id,
            (record) => record,
          ),
          async *iterate(options) {
            await Promise.resolve();
            guard();
            const { offset, limit } = iterationBounds(options);
            const sorted = [...db.migrationEvents.values()].sort(
              (a, b) =>
                Date.parse(a.at) - Date.parse(b.at) ||
                (a.kind === b.kind
                  ? a.index - b.index
                  : a.kind === 'decision'
                    ? -1
                    : 1),
            );
            for (const record of sorted.slice(offset, offset + limit)) {
              guard();
              yield structuredClone(record);
            }
          },
          clear() {
            guard(true);
            db.migrationEvents.clear();
            return Promise.resolve();
          },
          remove(id) {
            guard(true);
            db.migrationEvents.delete(id);
            return Promise.resolve();
          },
        },
      };
      try {
        const result = await operation(tx);
        if (writable) backing.current = db;
        return result;
      } finally {
        active = false;
      }
    };
    const result = backing.queue.then(run);
    backing.queue = result.catch(() => undefined);
    return result;
  };
  return {
    read: (operation) => transact(false, operation),
    write: (operation) => transact(true, operation),
    async close() {
      closed = true;
      await backing.queue;
    },
  };
}
