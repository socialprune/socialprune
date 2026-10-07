import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  WorkspaceMetaSchema,
} from '../model/index.ts';
import type { WorkspaceV2 } from '../model/index.ts';
import { WorkspaceError } from './errors.ts';
import { createWorkspace, importForItem, initialState } from './store.ts';
import type {
  AppendWriter,
  CommandReceipt,
  RecordWriter,
  StoredItem,
  StoredState,
  UniqueWriter,
  WorkspaceRuntime,
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
    runtime: { revision: 0 } satisfies WorkspaceRuntime,
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
    assessments: [...source.assessments],
    decisionEvents: [...source.decisionEvents],
    outcomeEvents: [...source.outcomeEvents],
  };
}

export function createMemoryStore(
  backing: MemoryStoreBacking = new MemoryStoreBacking(),
): WorkspaceStore {
  let closed = false;
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
        async *iterate() {
          await Promise.resolve();
          guard();
          for (const value of map.values()) {
            guard();
            yield structuredClone(value);
          }
        },
        put(record) {
          guard(true);
          const value = validate(record);
          map.set(key(value), structuredClone(value));
          return Promise.resolve();
        },
        add(record) {
          guard(true);
          const value = validate(record);
          if (map.has(key(value))) throw new WorkspaceError('DUPLICATE_ID');
          map.set(key(value), structuredClone(value));
          return Promise.resolve();
        },
      });
      const log = <R>(
        array: R[],
        key: (record: R) => string,
        validate: (record: R) => R,
      ): AppendWriter<R> => ({
        async *iterate() {
          await Promise.resolve();
          guard();
          for (const value of array) {
            guard();
            yield structuredClone(value);
          }
        },
        append(records) {
          guard(true);
          const known = new Set(array.map(key));
          const values = records.map(validate);
          for (const value of values) {
            if (known.has(key(value))) throw new WorkspaceError('DUPLICATE_ID');
            known.add(key(value));
          }
          array.push(...structuredClone(values));
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
            db.runtime = structuredClone(value);
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
        ),
        outcomeEvents: log(
          db.outcomeEvents,
          (record) => record.eventId,
          (record) => OutcomeEventSchema.parse(record),
        ),
        state: table(
          db.state,
          (record) => record.itemId,
          (record: StoredState) => record,
        ),
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
