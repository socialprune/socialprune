import type {
  Assessment,
  DecisionEvent,
  DecisionValue,
  ImportRecord,
  Item,
  OutcomeEvent,
  OutcomeValue,
  Submission,
  WorkspaceMeta,
  WorkspaceV2,
} from '../model/index.ts';
import { DEFAULT_CATEGORIES } from '../model/index.ts';
import type { WorkspaceErrorCode } from './errors.ts';
import { deriveState } from './state.ts';
import { validateWorkspace, workspaceCounts } from './validation.ts';

export interface StoredItem {
  item: Item;
  /** First accepted import controls visibility; metadata may come from another. */
  importId: string;
  metadataImportId: string;
}
export interface StoredState {
  itemId: string;
  decision: DecisionValue;
  outcome: OutcomeValue;
}
export type ReviewCommandResult =
  | {
      type: 'committed';
      commandId: string;
      actionId: string | null;
      revision: number;
      changed: number;
      skipped?: number;
    }
  | {
      type: 'rejected';
      commandId: string;
      code: WorkspaceErrorCode;
      changedSince?: number;
    };
export interface CommandReceipt {
  commandId: string;
  contentHash: string;
  result: ReviewCommandResult;
}
export interface WorkspaceRuntime {
  revision: number;
  lastEventSeq: number;
}
export interface MigrationEvent {
  id: string;
  kind: 'decision' | 'outcome';
  index: number;
  at: string;
  eventId: string;
  record: import('../model/v1.ts').Decision | import('../model/v1.ts').Outcome;
}
export interface RecordReader<T> {
  get(id: string): Promise<T | undefined>;
  iterate(options?: IterationOptions): AsyncIterable<T>;
}
export interface IterationOptions {
  offset?: number;
  limit?: number;
}
export interface OrderedReader<T> {
  iterate(options?: IterationOptions): AsyncIterable<T>;
}
export function iterationBounds(options: IterationOptions = {}): {
  offset: number;
  limit: number;
} {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 0
  )
    throw new RangeError('Invalid record iteration bounds.');
  return { offset, limit };
}
export interface RecordWriter<T> extends RecordReader<T> {
  put(value: T): Promise<void>;
}
export interface AppendWriter<T> extends OrderedReader<T> {
  append(values: readonly T[]): Promise<void>;
}
export interface UniqueWriter<T> extends RecordReader<T> {
  add(value: T): Promise<void>;
}
export interface ReadTransaction {
  meta: { get(): Promise<WorkspaceMeta> };
  runtime: { get(): Promise<WorkspaceRuntime> };
  commands: RecordReader<CommandReceipt>;
  imports: RecordReader<ImportRecord>;
  items: RecordReader<StoredItem>;
  submissions: RecordReader<Submission>;
  assessments: OrderedReader<Assessment>;
  decisionEvents: OrderedReader<DecisionEvent>;
  outcomeEvents: OrderedReader<OutcomeEvent>;
  state: RecordReader<StoredState>;
  /** Temporary staging records; ordered by time, decision before outcome, index. */
  migrationEvents: RecordReader<MigrationEvent>;
}
export interface WriteTransaction extends ReadTransaction {
  meta: ReadTransaction['meta'] & { set(value: WorkspaceMeta): Promise<void> };
  runtime: ReadTransaction['runtime'] & {
    set(value: { revision: number; lastEventSeq?: number }): Promise<void>;
  };
  commands: UniqueWriter<CommandReceipt>;
  imports: RecordWriter<ImportRecord>;
  items: RecordWriter<StoredItem>;
  submissions: UniqueWriter<Submission>;
  assessments: AppendWriter<Assessment>;
  decisionEvents: AppendWriter<DecisionEvent>;
  outcomeEvents: AppendWriter<OutcomeEvent>;
  state: RecordWriter<StoredState>;
  migrationEvents: UniqueWriter<MigrationEvent> & {
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };
}

/**
 * One callback is one transaction. Writes commit all accessors or none.
 * Callbacks await only transaction methods, never timers, crypto or network.
 * Returned records are detached; accessors expire when the callback finishes.
 * Implementations serialize writes and provide consistent read snapshots.
 */
export interface WorkspaceStore {
  read<T>(operation: (tx: ReadTransaction) => Promise<T>): Promise<T>;
  write<T>(operation: (tx: WriteTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function records<T>(source: OrderedReader<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const record of source.iterate()) result.push(record);
  return result;
}
export async function readWorkspace(tx: ReadTransaction): Promise<WorkspaceV2> {
  const meta = await tx.meta.get();
  const imports = await records(tx.imports);
  const stored = await records(tx.items);
  const arrays = {
    imports,
    items: stored.map(({ item }) => item),
    submissions: await records(tx.submissions),
    assessments: await records(tx.assessments),
    decisionEvents: await records(tx.decisionEvents),
    outcomeEvents: await records(tx.outcomeEvents),
  };
  return { ...meta, counts: workspaceCounts(arrays), ...arrays };
}
export function createWorkspace(
  options: {
    id?: string;
    kind?: 'personal' | 'demo';
    now?: Date;
    categories?: string[];
    timeZone?: string | null;
  } = {},
): WorkspaceV2 {
  const time = (options.now ?? new Date()).toISOString();
  return validateWorkspace({
    format: 'socialprune-workspace',
    schemaVersion: 2,
    id: options.id ?? crypto.randomUUID(),
    kind: options.kind ?? 'personal',
    createdAt: time,
    updatedAt: time,
    lastBackupAt: null,
    settings: {
      categories: options.categories ?? [...DEFAULT_CATEGORIES],
      timeZone: options.timeZone ?? null,
    },
    counts: {
      imports: 0,
      items: 0,
      assessments: 0,
      submissions: 0,
      decisionEvents: 0,
      outcomeEvents: 0,
    },
    imports: [],
    items: [],
    submissions: [],
    assessments: [],
    decisionEvents: [],
    outcomeEvents: [],
  });
}
export function initialState(workspace: WorkspaceV2): StoredState[] {
  return [...deriveState(workspace)].map(([itemId, state]) => ({
    itemId,
    decision: state.decision,
    outcome: state.outcome,
  }));
}
export function importForItem(
  item: Item,
  imports: readonly ImportRecord[],
): string {
  const matches = imports.filter(
    (record) =>
      record.platform === item.platform &&
      record.archives.includes(item.provenance.archive) &&
      record.accounts.some((account) => account.key === item.account.key),
  );
  return (
    matches.findLast((record) => record.status === 'complete')?.id ??
    matches.at(-1)?.id ??
    ''
  );
}
