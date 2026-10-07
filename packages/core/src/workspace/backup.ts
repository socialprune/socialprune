import { z } from 'zod';
import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  UtcTimestampSchema,
  WorkspaceCountsSchema,
  WorkspaceMetaSchema,
} from '../model/index.ts';
import type {
  WorkspaceCounts,
  WorkspaceMeta,
  WorkspaceV2,
} from '../model/index.ts';
import * as v1 from '../model/v1.ts';
import {
  ArchiveLimitError,
  DEFAULT_IMPORT_LIMITS,
  throwIfAborted,
} from '../archive/limits.ts';
import { JsonCursor, JsonFormatError } from '../json/cursor.ts';
import { WorkspaceError } from './errors.ts';
import { canonicalJson } from './canonical.ts';
import { deriveState } from './state.ts';
import { migrateV1 } from './migrate.ts';
import { importForItem } from './store.ts';
import type { ReadTransaction, WorkspaceStore } from './store.ts';
import { validateWorkspace } from './validation.ts';

const ARRAY_KEYS = [
  'imports',
  'items',
  'submissions',
  'assessments',
  'decisionEvents',
  'outcomeEvents',
] as const;
type ArrayKey = (typeof ARRAY_KEYS)[number];
export interface BackupOptions {
  signal?: AbortSignal;
  chunkBytes?: number;
  batchSize?: number;
  maxElementBytes?: number;
  now?: Date;
}
export interface BackupSession {
  readonly createdAt: string;
  readonly chunks: AsyncIterable<Uint8Array>;
  /** Call only after the platform's sink has successfully closed. */
  complete(): Promise<void>;
}
export interface BackupReadOptions {
  signal?: AbortSignal;
  maxElementBytes?: number;
}
export interface BackupApplyOptions {
  signal?: AbortSignal;
  batchSize?: number;
}
export type BackupPart =
  | { type: 'header'; name: string; value: unknown }
  | { type: 'record'; name: string; index: number; value: unknown }
  | { type: 'arrayEnd'; name: string };

function positive(value: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError('Invalid backup bound.');
  return value;
}
async function page(
  tx: ReadTransaction,
  key: ArrayKey,
  offset: number,
  limit: number,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of tx[key].iterate({ offset, limit }))
    values.push(
      key === 'items'
        ? ItemSchema.parse((value as { item: unknown }).item)
        : value,
    );
  return values;
}

export function createBackup(
  store: WorkspaceStore,
  options: BackupOptions = {},
): BackupSession {
  const chunkBytes = positive(
    options.chunkBytes ?? 64 * 1024,
    16 * 1024 * 1024,
  );
  const batchSize = positive(options.batchSize ?? 1, 1000);
  const maxElementBytes = positive(
    options.maxElementBytes ?? DEFAULT_IMPORT_LIMITS.maxElementBytes,
  );
  const createdAt = UtcTimestampSchema.parse(
    (options.now ?? new Date()).toISOString(),
  );
  let consumed = false;
  let finished = false;
  let completed = false;
  let sourceMeta: WorkspaceMeta | undefined;
  let revision: number | undefined;
  const guardSnapshot = async (tx: ReadTransaction): Promise<void> => {
    throwIfAborted(options.signal);
    const current = await tx.meta.get();
    if (
      (await tx.runtime.get()).revision !== revision ||
      canonicalJson(current) !== canonicalJson(sourceMeta)
    )
      throw new WorkspaceError('BACKUP_CHANGED');
  };
  async function* pieces(): AsyncGenerator<string> {
    throwIfAborted(options.signal);
    const initial = await store.read(async (tx) => ({
      meta: await tx.meta.get(),
      revision: (await tx.runtime.get()).revision,
    }));
    sourceMeta = initial.meta;
    revision = initial.revision;
    const counts: WorkspaceCounts = {
      imports: 0,
      items: 0,
      submissions: 0,
      assessments: 0,
      decisionEvents: 0,
      outcomeEvents: 0,
    };
    for (const key of ARRAY_KEYS) {
      counts[key] = await store.read(async (tx) => {
        await guardSnapshot(tx);
        let count = 0;
        for await (const _value of tx[key].iterate()) {
          void _value;
          throwIfAborted(options.signal);
          count++;
        }
        return count;
      });
    }
    const header = { ...sourceMeta, lastBackupAt: createdAt, counts };
    yield '{';
    let comma = false;
    for (const key of [
      'format',
      'schemaVersion',
      'id',
      'kind',
      'createdAt',
      'updatedAt',
      'lastBackupAt',
      'settings',
      'counts',
    ] as const) {
      yield `${comma ? ',' : ''}${JSON.stringify(key)}:${JSON.stringify(header[key])}`;
      comma = true;
    }
    for (const key of ARRAY_KEYS) {
      yield `,${JSON.stringify(key)}:[`;
      let first = true;
      for (let offset = 0; ; offset += batchSize) {
        const values = await store.read(async (tx) => {
          await guardSnapshot(tx);
          return page(tx, key, offset, batchSize);
        });
        for (const value of values) {
          throwIfAborted(options.signal);
          const text = JSON.stringify(value);
          if (new TextEncoder().encode(text).length > maxElementBytes)
            throw new ArchiveLimitError('maxElementBytes', maxElementBytes);
          yield `${first ? '' : ','}${text}`;
          first = false;
        }
        if (values.length < batchSize) break;
      }
      yield ']';
    }
    await store.read(guardSnapshot);
    yield '}';
  }
  const chunks: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      if (consumed) throw new WorkspaceError('BACKUP_INCOMPLETE');
      consumed = true;
      let buffer = new Uint8Array(chunkBytes),
        used = 0;
      for await (const text of pieces()) {
        const bytes = new TextEncoder().encode(text);
        for (let offset = 0; offset < bytes.length;) {
          throwIfAborted(options.signal);
          const length = Math.min(chunkBytes - used, bytes.length - offset);
          buffer.set(bytes.subarray(offset, offset + length), used);
          used += length;
          offset += length;
          if (used === chunkBytes) {
            yield buffer;
            buffer = new Uint8Array(chunkBytes);
            used = 0;
          }
        }
      }
      if (used) yield buffer.slice(0, used);
      throwIfAborted(options.signal);
      finished = true;
    },
  };
  return {
    createdAt,
    chunks,
    async complete() {
      throwIfAborted(options.signal);
      if (!finished || !sourceMeta)
        throw new WorkspaceError('BACKUP_INCOMPLETE');
      if (completed) return;
      await store.write(async (tx) => {
        await guardSnapshot(tx);
        await tx.meta.set({ ...sourceMeta!, lastBackupAt: createdAt });
      });
      completed = true;
    },
  };
}

async function* decoded(
  chunks: AsyncIterable<string | Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let binary = false;
  for await (const chunk of chunks) {
    throwIfAborted(signal);
    if (typeof chunk === 'string') {
      if (binary) {
        const tail = decoder.decode();
        if (tail) yield tail;
        binary = false;
      }
      yield chunk;
    } else {
      binary = true;
      yield decoder.decode(chunk, { stream: true });
    }
  }
  if (binary) {
    const tail = decoder.decode();
    if (tail) yield tail;
  }
}
async function jsonValue(
  cursor: JsonCursor,
  maxBytes: number,
): Promise<unknown> {
  const first = await cursor.nonWhitespace();
  if (first === null || first === ',' || first === ']' || first === '}')
    throw new JsonFormatError();
  cursor.unread(first);
  let depth = 0,
    inString = false,
    escape = false,
    bytes = 0,
    high = false;
  const pieces: string[] = [];
  let chunk: string | null;
  while ((chunk = await cursor.nextChunk()) !== null) {
    let end = chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i);
      if (
        !inString &&
        depth === 0 &&
        (code === 44 || code === 93 || code === 125)
      ) {
        end = i;
        cursor.unreadChunk(chunk.slice(i));
        break;
      }
      bytes +=
        code <= 127
          ? 1
          : code <= 2047
            ? 2
            : code >= 0xdc00 && code <= 0xdfff && high
              ? 1
              : 3;
      high = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes)
        throw new ArchiveLimitError('maxElementBytes', maxBytes);
      if (inString) {
        if (escape) escape = false;
        else if (code === 92) escape = true;
        else if (code === 34) inString = false;
      } else if (code === 34) inString = true;
      else if (code === 91 || code === 123) depth++;
      else if (code === 93 || code === 125) {
        if (--depth < 0) throw new JsonFormatError();
      }
    }
    pieces.push(chunk.slice(0, end));
    if (end < chunk.length) {
      if (inString || depth !== 0) throw new JsonFormatError();
      try {
        return JSON.parse(pieces.join(''));
      } catch {
        throw new JsonFormatError();
      }
    }
  }
  throw new JsonFormatError();
}
async function propertyName(cursor: JsonCursor): Promise<string> {
  if ((await cursor.nonWhitespace()) !== '"') throw new JsonFormatError();
  let text = '"',
    escape = false;
  for (;;) {
    const character = await cursor.next();
    if (character === null || text.length > 256) throw new JsonFormatError();
    text += character;
    if (escape) escape = false;
    else if (character === '\\') escape = true;
    else if (character === '"') break;
  }
  try {
    return z.string().parse(JSON.parse(text));
  } catch {
    throw new JsonFormatError();
  }
}
const v2Records: Record<ArrayKey, z.ZodType> = {
  imports: ImportRecordSchema,
  items: ItemSchema,
  submissions: SubmissionSchema,
  assessments: AssessmentSchema,
  decisionEvents: DecisionEventSchema,
  outcomeEvents: OutcomeEventSchema,
};
const v1Records: Record<string, z.ZodType> = {
  imports: v1.ImportRecordSchema,
  items: v1.ItemSchema,
  assessments: v1.AssessmentSchema,
  decisions: v1.DecisionSchema,
  outcomes: v1.OutcomeSchema,
};
/** Internal record cursor; it never accumulates a backup's arrays. */
export async function* backupParts(
  chunks: AsyncIterable<string | Uint8Array>,
  options: BackupReadOptions = {},
): AsyncGenerator<BackupPart> {
  const maxBytes = positive(
    options.maxElementBytes ?? DEFAULT_IMPORT_LIMITS.maxElementBytes,
  );
  const cursor = new JsonCursor(
    decoded(chunks, options.signal),
    options.signal,
  );
  const names = new Set<string>();
  let version: number | undefined;
  const known = new Set([
    'format',
    'schemaVersion',
    'id',
    'kind',
    'createdAt',
    'updatedAt',
    'lastBackupAt',
    'settings',
    'counts',
    ...ARRAY_KEYS,
    'decisions',
    'outcomes',
  ]);
  try {
    if ((await cursor.nonWhitespace()) !== '{') throw new JsonFormatError();
    for (;;) {
      const name = await propertyName(cursor);
      if (!known.has(name) || names.has(name))
        throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
      names.add(name);
      if ((await cursor.nonWhitespace()) !== ':') throw new JsonFormatError();
      if (Object.hasOwn(v2Records, name) || Object.hasOwn(v1Records, name)) {
        const current = v2Records[name as ArrayKey],
          old = v1Records[name];
        const schema =
          version === undefined
            ? current && old
              ? z.union([current, old])
              : (current ?? old)
            : version === 1
              ? old
              : current;
        if (!schema) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
        if ((await cursor.nonWhitespace()) !== '[') throw new JsonFormatError();
        let index = 0;
        let next = await cursor.nonWhitespace();
        if (next !== ']') {
          cursor.unread(next);
          for (;;) {
            const parsed = schema.safeParse(await jsonValue(cursor, maxBytes));
            if (!parsed.success)
              throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
            yield { type: 'record', name, index: index++, value: parsed.data };
            next = await cursor.nonWhitespace();
            if (next === ']') break;
            if (next !== ',') throw new JsonFormatError();
          }
        }
        yield { type: 'arrayEnd', name };
      } else {
        const value = await jsonValue(cursor, maxBytes);
        if (name === 'schemaVersion') {
          if (
            typeof value !== 'number' ||
            !Number.isInteger(value) ||
            value < 1
          )
            throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
          if (value > 2) throw new WorkspaceError('BACKUP_SCHEMA_UNSUPPORTED');
          version = value;
        }
        yield { type: 'header', name, value };
      }
      const next = await cursor.nonWhitespace();
      if (next === '}') break;
      if (next !== ',') throw new JsonFormatError();
    }
    if ((await cursor.nonWhitespace()) !== null) throw new JsonFormatError();
    throwIfAborted(options.signal);
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof WorkspaceError || error instanceof ArchiveLimitError)
      throw error;
    throw new WorkspaceError('BACKUP_INVALID_JSON');
  } finally {
    await cursor.close();
  }
}
/** Small-input convenience; streaming restore never calls this graph materializer. */
export async function readBackup(
  chunks: AsyncIterable<string | Uint8Array>,
  options: BackupReadOptions = {},
): Promise<WorkspaceV2> {
  const maxBytes = positive(
    options.maxElementBytes ?? DEFAULT_IMPORT_LIMITS.maxElementBytes,
  );
  const cursor = new JsonCursor(
    decoded(chunks, options.signal),
    options.signal,
  );
  const document: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const seenProperties = new Set<string>();
  const seenIds = new Map<string, string>();
  const rawCounts: Record<string, number> = {};
  const duplicates: Record<string, number> = {};
  let version: number | undefined;
  const uniqueProperties = new Set([
    'format',
    'schemaVersion',
    'id',
    'kind',
    'createdAt',
    'updatedAt',
    'lastBackupAt',
    'settings',
    'counts',
    ...ARRAY_KEYS,
    'decisions',
    'outcomes',
  ]);
  try {
    if ((await cursor.nonWhitespace()) !== '{') throw new JsonFormatError();
    for (;;) {
      const name = await propertyName(cursor);
      if (!uniqueProperties.has(name) || seenProperties.has(name))
        throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
      seenProperties.add(name);
      if ((await cursor.nonWhitespace()) !== ':') throw new JsonFormatError();
      if (name === 'schemaVersion') {
        const value = await jsonValue(cursor, maxBytes);
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
          throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
        if (value > 2) throw new WorkspaceError('BACKUP_SCHEMA_UNSUPPORTED');
        version = value;
        document[name] = value;
      } else if (
        [
          'imports',
          'items',
          'submissions',
          'assessments',
          'decisionEvents',
          'outcomeEvents',
          'decisions',
          'outcomes',
        ].includes(name)
      ) {
        const current = v2Records[name as ArrayKey];
        const old = v1Records[name];
        const schema =
          version === undefined
            ? current && old
              ? z.union([current, old])
              : (current ?? old)
            : version === 1
              ? old
              : current;
        if (!schema) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
        if ((await cursor.nonWhitespace()) !== '[') throw new JsonFormatError();
        const values: unknown[] = [];
        let next = await cursor.nonWhitespace();
        if (next !== ']') {
          cursor.unread(next);
          for (;;) {
            const value = schema.safeParse(await jsonValue(cursor, maxBytes));
            if (!value.success)
              throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
            rawCounts[name] = (rawCounts[name] ?? 0) + 1;
            const idKey =
              version !== 1 &&
              [
                'assessments',
                'decisionEvents',
                'outcomeEvents',
                'submissions',
              ].includes(name)
                ? name === 'assessments'
                  ? 'assessmentId'
                  : name === 'submissions'
                    ? 'submissionId'
                    : 'eventId'
                : null;
            if (idKey) {
              const record = value.data as Record<string, unknown>;
              if (!Object.hasOwn(record, idKey)) {
                values.push(value.data);
                next = await cursor.nonWhitespace();
                if (next === ']') break;
                if (next !== ',') throw new JsonFormatError();
                continue;
              }
              const id = `${idKey}:${String(record[idKey])}`,
                canonical = canonicalJson(record);
              const prior = seenIds.get(id);
              if (prior !== undefined) {
                if (prior !== canonical)
                  throw new WorkspaceError(
                    idKey === 'assessmentId'
                      ? 'ASSESSMENT_CONFLICT'
                      : idKey === 'submissionId'
                        ? 'SUBMISSION_CONFLICT'
                        : 'EVENT_CONFLICT',
                  );
                duplicates[name] = (duplicates[name] ?? 0) + 1;
              } else {
                seenIds.set(id, canonical);
                values.push(value.data);
              }
            } else values.push(value.data);
            next = await cursor.nonWhitespace();
            if (next === ']') break;
            if (next !== ',') throw new JsonFormatError();
          }
        }
        document[name] = values;
      } else document[name] = await jsonValue(cursor, maxBytes);
      const next = await cursor.nonWhitespace();
      if (next === '}') break;
      if (next !== ',') throw new JsonFormatError();
    }
    if ((await cursor.nonWhitespace()) !== null) throw new JsonFormatError();
    throwIfAborted(options.signal);
    if (version === 1) {
      const migrated = await migrateV1(document);
      throwIfAborted(options.signal);
      return migrated;
    }
    if (version !== 2) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
    const declared = WorkspaceCountsSchema.safeParse(document.counts);
    if (!declared.success) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
    const counts = { ...declared.data };
    for (const key of ARRAY_KEYS) {
      if (counts[key] !== (rawCounts[key] ?? 0))
        throw new WorkspaceError('COUNT_MISMATCH');
      counts[key] -= duplicates[key] ?? 0;
    }
    document.counts = counts;
    return validateWorkspace(document);
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof WorkspaceError || error instanceof ArchiveLimitError)
      throw error;
    throw new WorkspaceError('BACKUP_INVALID_JSON');
  } finally {
    await cursor.close();
  }
}

/** Small already-validated document helper; large restores use restoreBackup. */
export async function applyBackup(
  store: WorkspaceStore,
  input: unknown,
  options: BackupApplyOptions = {},
): Promise<WorkspaceV2> {
  throwIfAborted(options.signal);
  const workspace = validateWorkspace(input);
  const state = deriveState(workspace);
  const batchSize = positive(options.batchSize ?? 1000, 1000);
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
  await store.write(async (tx) => {
    throwIfAborted(options.signal);
    for (const key of ARRAY_KEYS) {
      for await (const _value of tx[key].iterate({ limit: 1 })) {
        void _value;
        throw new WorkspaceError('RESTORE_TARGET_NOT_EMPTY');
      }
    }
    for (const table of [tx.state, tx.commands])
      for await (const _value of table.iterate({ limit: 1 })) {
        void _value;
        throw new WorkspaceError('RESTORE_TARGET_NOT_EMPTY');
      }
    const runtime = await tx.runtime.get();
    await tx.meta.set(WorkspaceMetaSchema.parse(meta));
    for (const record of imports) {
      throwIfAborted(options.signal);
      await tx.imports.put(record);
    }
    for (const item of items) {
      throwIfAborted(options.signal);
      const importId = importForItem(item, imports);
      await tx.items.put({ item, importId, metadataImportId: importId });
      const derived = state.get(item.id)!;
      await tx.state.put({
        itemId: item.id,
        decision: derived.decision,
        outcome: derived.outcome,
      });
    }
    for (const record of submissions) {
      throwIfAborted(options.signal);
      await tx.submissions.add(record);
    }
    for (let offset = 0; offset < assessments.length; offset += batchSize) {
      throwIfAborted(options.signal);
      await tx.assessments.append(
        assessments.slice(offset, offset + batchSize),
      );
    }
    for (let offset = 0; offset < decisionEvents.length; offset += batchSize) {
      throwIfAborted(options.signal);
      await tx.decisionEvents.append(
        decisionEvents.slice(offset, offset + batchSize),
      );
    }
    for (let offset = 0; offset < outcomeEvents.length; offset += batchSize) {
      throwIfAborted(options.signal);
      await tx.outcomeEvents.append(
        outcomeEvents.slice(offset, offset + batchSize),
      );
    }
    throwIfAborted(options.signal);
    await tx.runtime.set({ revision: runtime.revision + 1 });
  });
  return workspace;
}
export { restoreBackup, RestoreFailure } from './restore.ts';
export type { RestoreResult, RestoreOptions } from './restore.ts';
