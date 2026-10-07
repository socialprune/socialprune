import {
  AssessmentSchema,
  DecisionEventSchema,
  ImportRecordSchema,
  ItemSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  WorkspaceCountsSchema,
  WorkspaceMetaSchema,
} from '../model/index.ts';
import type {
  Action,
  Assessment,
  DecisionEvent,
  ImportRecord,
  OutcomeEvent,
  Submission,
  WorkspaceCounts,
  WorkspaceMeta,
} from '../model/index.ts';
import * as v1 from '../model/v1.ts';
import { throwIfAborted } from '../archive/limits.ts';
import { backupParts } from './backup.ts';
import type { BackupApplyOptions, BackupReadOptions } from './backup.ts';
import { canonicalJson, contentHash } from './canonical.ts';
import { WorkspaceError } from './errors.ts';
import type { WorkspaceErrorCode } from './errors.ts';
import type {
  MigrationEvent,
  WorkspaceStore,
  WriteTransaction,
} from './store.ts';

export type RestoreOptions = BackupReadOptions & BackupApplyOptions;
export interface RestoreResult {
  meta: WorkspaceMeta;
  counts: WorkspaceCounts;
  lastEventSeq: number;
  migratedFrom: 1 | null;
}
/** The staging target must be discarded on every rejection; active data is separate. */
export class RestoreFailure extends WorkspaceError {
  readonly discardTarget = true;
  constructor(code: WorkspaceErrorCode) {
    super(code);
  }
}
const ARRAY_KEYS = [
  'imports',
  'items',
  'submissions',
  'assessments',
  'decisionEvents',
  'outcomeEvents',
] as const;
type ArrayKey = (typeof ARRAY_KEYS)[number];
const decisionValues = ['undecided', 'keep', 'delete', 'later'] as const;
const outcomeValues = ['unknown', 'deleted-by-user', 'skipped'] as const;
const STATE_KIND = 4;
const KNOWN_ITEM = 16;
interface ActionIndex {
  action: Action;
  domain: 'decision' | 'outcome';
  count: number;
  minSeq: number;
  maxSeq: number;
  items: Set<string>;
}
interface SubmissionIndex {
  source: string;
  declared: number;
  actual: number;
}
type BufferedRecord = {
  name: ArrayKey | 'decisions' | 'outcomes';
  index: number;
  value: unknown;
};

export async function restoreBackup(
  store: WorkspaceStore,
  chunks: AsyncIterable<string | Uint8Array>,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const batchSize = options.batchSize ?? 1000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new RestoreFailure('INVALID_REQUEST');
  const header: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const itemHeads = new Map<string, number>();
  const references = new Set<string>();
  const uniqueIds = new Set<string>();
  const duplicateHashes = new Map<string, string>();
  const sequenceSet = new Set<number>();
  const actions = new Map<string, ActionIndex>();
  const submissions = new Map<string, SubmissionIndex>();
  const assessmentSubmissions = new Map<
    string,
    { source: string; count: number }
  >();
  const categories = new Set<string>();
  let fixtureAssessment = false;
  const rawCounts: WorkspaceCounts = {
    imports: 0,
    items: 0,
    submissions: 0,
    assessments: 0,
    decisionEvents: 0,
    outcomeEvents: 0,
  };
  const counts = { ...rawCounts };
  const arraysSeen = new Set<string>();
  let lastDecisionSeq = 0,
    lastOutcomeSeq = 0,
    highSeq = 0;
  let version: number | undefined;
  let provisionalVersion: number | undefined;
  let buffers: BufferedRecord[] = [];
  let pendingLegacyEvents = 0;

  const acceptUnique = (name: string, id: string) => {
    const key = `${name}:${id}`;
    if (uniqueIds.has(key)) throw new WorkspaceError('DUPLICATE_ID');
    uniqueIds.add(key);
  };
  const acceptDuplicate = async (
    name: string,
    id: string,
    value: unknown,
  ): Promise<boolean> => {
    const key = `${name}:${id}`;
    const hash = await contentHash(canonicalJson(value));
    const prior = duplicateHashes.get(key);
    if (prior !== undefined) {
      if (prior !== hash)
        throw new WorkspaceError(
          name === 'assessment'
            ? 'ASSESSMENT_CONFLICT'
            : name === 'submission'
              ? 'SUBMISSION_CONFLICT'
              : 'EVENT_CONFLICT',
        );
      return false;
    }
    duplicateHashes.set(key, hash);
    return true;
  };
  const checkEvent = (
    event: DecisionEvent | OutcomeEvent,
    domain: 'decision' | 'outcome',
  ) => {
    if (
      sequenceSet.has(event.seq) ||
      event.seq <= (domain === 'decision' ? lastDecisionSeq : lastOutcomeSeq)
    )
      throw new WorkspaceError('EVENT_SEQUENCE');
    sequenceSet.add(event.seq);
    highSeq = Math.max(highSeq, event.seq);
    if (domain === 'decision') lastDecisionSeq = event.seq;
    else lastOutcomeSeq = event.seq;
    references.add(event.itemId);
    const packed = itemHeads.get(event.itemId) ?? 0;
    const head = packed % KNOWN_ITEM;
    const known = packed >= KNOWN_ITEM ? KNOWN_ITEM : 0;
    if (domain === 'decision') {
      const value = event as DecisionEvent;
      if (decisionValues[head % STATE_KIND] !== value.previous)
        throw new WorkspaceError('EVENT_CHAIN');
      itemHeads.set(
        event.itemId,
        known +
          Math.floor(head / STATE_KIND) * STATE_KIND +
          decisionValues.indexOf(value.value),
      );
    } else {
      const value = event as OutcomeEvent;
      if (outcomeValues[Math.floor(head / STATE_KIND)] !== value.previous)
        throw new WorkspaceError('EVENT_CHAIN');
      itemHeads.set(
        event.itemId,
        known +
          (head % STATE_KIND) +
          outcomeValues.indexOf(value.value) * STATE_KIND,
      );
    }
    if (event.value === event.previous && event.action.kind !== 'migrated')
      throw new WorkspaceError('ACTION_INVALID');
    const action = event.action;
    if (
      (action.kind === 'single' || action.kind === 'migrated') &&
      (action.size !== 1 || action.reverts !== null)
    )
      throw new WorkspaceError('ACTION_INVALID');
    if (action.kind === 'bulk' && action.reverts !== null)
      throw new WorkspaceError('ACTION_INVALID');
    if (
      (action.kind === 'undo' || action.kind === 'redo') &&
      action.reverts === null
    )
      throw new WorkspaceError('ACTION_INVALID');
    if (
      'recordedAt' in event &&
      event.source.via === 'v1-unrecorded' &&
      action.kind !== 'migrated'
    )
      throw new WorkspaceError('ACTION_INVALID');
    const existing = actions.get(action.id);
    if (existing) {
      if (
        existing.domain !== domain ||
        canonicalJson(existing.action) !== canonicalJson(action) ||
        existing.items.has(event.itemId)
      )
        throw new WorkspaceError('ACTION_INVALID');
      existing.count++;
      existing.items.add(event.itemId);
      existing.maxSeq = event.seq;
    } else
      actions.set(action.id, {
        action,
        domain,
        count: 1,
        minSeq: event.seq,
        maxSeq: event.seq,
        items: new Set([event.itemId]),
      });
  };
  const flush = async () => {
    if (!buffers.length) return;
    throwIfAborted(options.signal);
    const batch = buffers;
    buffers = [];
    await store.write(async (tx) => {
      for (const record of batch) {
        throwIfAborted(options.signal);
        if (record.name === 'imports')
          await tx.imports.put(record.value as ImportRecord);
        else if (record.name === 'items') {
          const item = ItemSchema.parse(record.value);
          await tx.items.put({ item, importId: '', metadataImportId: '' });
        } else if (record.name === 'submissions')
          await tx.submissions.add(record.value as Submission);
        else if (record.name === 'assessments')
          await tx.assessments.append([record.value as Assessment]);
        else if (record.name === 'decisionEvents')
          await tx.decisionEvents.append([record.value as DecisionEvent]);
        else if (record.name === 'outcomeEvents')
          await tx.outcomeEvents.append([record.value as OutcomeEvent]);
        else await tx.migrationEvents.add(record.value as MigrationEvent);
      }
    });
  };
  const buffered = async (
    name: BufferedRecord['name'],
    index: number,
    value: unknown,
  ) => {
    buffers.push({ name, index, value });
    if (buffers.length >= batchSize) await flush();
  };
  const accept = async (record: BufferedRecord) => {
    const { name, index } = record;
    provisionalVersion =
      provisionalVersion === undefined ? version : provisionalVersion;
    if (name === 'imports') {
      const value =
        version === 1
          ? {
              ...v1.ImportRecordSchema.parse(record.value),
              status: 'complete' as const,
            }
          : ImportRecordSchema.parse(record.value);
      acceptUnique(name, value.id);
      rawCounts.imports++;
      counts.imports++;
      await buffered(name, index, value);
    } else if (name === 'items') {
      const value =
        version === 1
          ? { ...v1.ItemSchema.parse(record.value), mediaCount: null }
          : ItemSchema.parse(record.value);
      if (!value.id.startsWith(`${value.platform}:`))
        throw new WorkspaceError('INVALID_ITEM_ID');
      const head = itemHeads.get(value.id) ?? 0;
      if (head >= KNOWN_ITEM) throw new WorkspaceError('DUPLICATE_ID');
      itemHeads.set(value.id, head + KNOWN_ITEM);
      references.delete(value.id);
      rawCounts.items++;
      counts.items++;
      await buffered(name, index, value);
    } else if (name === 'assessments') {
      const value =
        version === 1
          ? {
              ...v1.AssessmentSchema.parse(record.value),
              assessmentId: `v1-${(await contentHash(JSON.stringify([index, v1.AssessmentSchema.parse(record.value)]))).slice(7)}`,
              submissionId: null,
            }
          : AssessmentSchema.parse(record.value);
      rawCounts.assessments++;
      if (!(await acceptDuplicate('assessment', value.assessmentId, value)))
        return;
      counts.assessments++;
      if ((itemHeads.get(value.itemId) ?? 0) < KNOWN_ITEM)
        references.add(value.itemId);
      categories.add(value.category);
      fixtureAssessment ||= value.source.kind === 'fixture';
      if (value.submissionId !== null) {
        const source = canonicalJson(value.source),
          existing = assessmentSubmissions.get(value.submissionId);
        if (existing && existing.source !== source)
          throw new WorkspaceError('INVALID_LABEL');
        assessmentSubmissions.set(value.submissionId, {
          source,
          count: (existing?.count ?? 0) + 1,
        });
      }
      await buffered(name, index, value);
    } else if (name === 'submissions') {
      const value = SubmissionSchema.parse(record.value);
      rawCounts.submissions++;
      if (!(await acceptDuplicate('submission', value.submissionId, value)))
        return;
      counts.submissions++;
      submissions.set(value.submissionId, {
        source: canonicalJson(value.source),
        declared: value.labelCount,
        actual: 0,
      });
      await buffered(name, index, value);
    } else if (name === 'decisions' || name === 'outcomes') {
      if (version !== 1) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
      const kind = name === 'decisions' ? 'decision' : 'outcome';
      const value =
        kind === 'decision'
          ? v1.DecisionSchema.parse(record.value)
          : v1.OutcomeSchema.parse(record.value);
      const eventId = `v1-${(await contentHash(JSON.stringify([kind, index, value]))).slice(7)}`;
      await buffered(name, index, {
        id: `${kind}:${index}`,
        kind,
        index,
        at: 'decidedAt' in value ? value.decidedAt : value.recordedAt,
        eventId,
        record: value,
      });
      pendingLegacyEvents++;
    } else {
      if (version !== 2) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
      const value =
        name === 'decisionEvents'
          ? DecisionEventSchema.parse(record.value)
          : OutcomeEventSchema.parse(record.value);
      rawCounts[name]++;
      if (!(await acceptDuplicate('event', value.eventId, value))) return;
      checkEvent(value, name === 'decisionEvents' ? 'decision' : 'outcome');
      counts[name]++;
      await buffered(name, index, value);
    }
  };
  const ensureEmpty = async (tx: WriteTransaction) => {
    for (const key of [
      ...ARRAY_KEYS,
      'state',
      'commands',
      'migrationEvents',
    ] as const)
      for await (const record of tx[key].iterate({ limit: 1 })) {
        void record;
        throw new WorkspaceError('RESTORE_TARGET_NOT_EMPTY');
      }
  };
  try {
    throwIfAborted(options.signal);
    await store.write(ensureEmpty);
    for await (const part of backupParts(chunks, options)) {
      throwIfAborted(options.signal);
      if (part.type === 'header') {
        header[part.name] = part.value;
        if (part.name === 'schemaVersion') version = part.value as number;
      } else if (part.type === 'arrayEnd') arraysSeen.add(part.name);
      else if (version === undefined) {
        const value = part.value as Record<string, unknown>;
        const inferred =
          part.name === 'decisions' || part.name === 'outcomes'
            ? 1
            : part.name === 'items'
              ? Object.hasOwn(value, 'mediaCount')
                ? 2
                : 1
              : part.name === 'assessments'
                ? Object.hasOwn(value, 'assessmentId')
                  ? 2
                  : 1
                : part.name === 'imports'
                  ? Object.hasOwn(value, 'status')
                    ? 2
                    : 1
                  : 2;
        if (provisionalVersion !== undefined && provisionalVersion !== inferred)
          throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
        provisionalVersion = inferred;
        const saved = version;
        version = inferred;
        await accept({ ...part, name: part.name as BufferedRecord['name'] });
        version = saved;
      } else
        await accept({ ...part, name: part.name as BufferedRecord['name'] });
    }
    if (version !== 1 && version !== 2)
      throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
    if (provisionalVersion !== undefined && provisionalVersion !== version)
      throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
    await flush();
    const expectedArrays =
      version === 1
        ? ['imports', 'items', 'assessments', 'decisions', 'outcomes']
        : [...ARRAY_KEYS];
    if (
      expectedArrays.some((name) => !arraysSeen.has(name)) ||
      [...arraysSeen].some((name) => !expectedArrays.includes(name))
    )
      throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
    let meta: WorkspaceMeta;
    if (version === 1) {
      const schema = v1.WorkspaceSchema.omit({
        imports: true,
        items: true,
        assessments: true,
        decisions: true,
        outcomes: true,
      });
      const old = schema.safeParse(header);
      if (!old.success) throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
      const importIds: string[] = [];
      await store.read(async (tx) => {
        for await (const record of tx.imports.iterate())
          importIds.push(record.id);
      });
      meta = WorkspaceMetaSchema.parse({
        format: 'socialprune-workspace',
        schemaVersion: 2,
        id: `v1-${(await contentHash(old.data.createdAt + importIds.join(''))).slice(7)}`,
        kind: 'personal',
        createdAt: old.data.createdAt,
        updatedAt: old.data.updatedAt,
        lastBackupAt: null,
        settings: { categories: old.data.settings.categories, timeZone: null },
      });
      // V1 has no cross-log order. Stage backends sort timestamp, decisions
      // before outcomes on ties, then original array index deterministically.
      for (let offset = 0; offset < pendingLegacyEvents; offset += batchSize) {
        const batch = await store.read(async (tx) => {
          const result: MigrationEvent[] = [];
          for await (const value of tx.migrationEvents.iterate({
            offset,
            limit: batchSize,
          }))
            result.push(value);
          return result;
        });
        for (const record of batch) {
          const head = (itemHeads.get(record.record.itemId) ?? 0) % KNOWN_ITEM;
          const common = {
            eventId: record.eventId,
            seq: highSeq + 1,
            itemId: record.record.itemId,
            action: {
              id: record.eventId,
              kind: 'migrated' as const,
              size: 1,
              reverts: null,
            },
          };
          if (record.kind === 'decision') {
            const old = record.record as v1.Decision;
            const event = DecisionEventSchema.parse({
              ...old,
              ...common,
              previous: decisionValues[head % STATE_KIND],
            });
            checkEvent(event, 'decision');
            counts.decisionEvents++;
            await buffered('decisionEvents', record.index, event);
          } else {
            const old = record.record as v1.Outcome;
            const event = OutcomeEventSchema.parse({
              ...old,
              ...common,
              previous: outcomeValues[Math.floor(head / STATE_KIND)],
              source: { kind: 'human', via: 'v1-unrecorded' },
            });
            checkEvent(event, 'outcome');
            counts.outcomeEvents++;
            await buffered('outcomeEvents', record.index, event);
          }
        }
      }
      await flush();
      await store.write((tx) => tx.migrationEvents.clear());
    } else {
      const parsed = WorkspaceMetaSchema.safeParse(
        Object.fromEntries(
          Object.entries(header).filter(([key]) => key !== 'counts'),
        ),
      );
      const declared = WorkspaceCountsSchema.safeParse(header.counts);
      if (!parsed.success || !declared.success)
        throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
      meta = parsed.data;
      for (const key of ARRAY_KEYS)
        if (declared.data[key] !== rawCounts[key])
          throw new WorkspaceError('COUNT_MISMATCH');
    }
    for (const id of references)
      if ((itemHeads.get(id) ?? 0) < KNOWN_ITEM)
        throw new WorkspaceError('UNKNOWN_ITEM');
    if (fixtureAssessment && meta.kind !== 'demo')
      throw new WorkspaceError('FIXTURE_NOT_ALLOWED');
    for (const category of categories)
      if (!meta.settings.categories.includes(category))
        throw new WorkspaceError('UNKNOWN_CATEGORY');
    for (const [id, assessment] of assessmentSubmissions) {
      const submission = submissions.get(id);
      if (!submission) throw new WorkspaceError('UNKNOWN_SUBMISSION');
      if (submission.source !== assessment.source)
        throw new WorkspaceError('INVALID_LABEL');
      submission.actual = assessment.count;
    }
    for (const submission of submissions.values())
      if (submission.declared !== submission.actual)
        throw new WorkspaceError('COUNT_MISMATCH');
    for (const [id, group] of actions) {
      if (group.action.size !== group.count)
        throw new WorkspaceError('ACTION_INVALID');
      if (group.action.reverts !== null) {
        const previous = actions.get(group.action.reverts);
        if (
          !previous ||
          previous.maxSeq >= group.minSeq ||
          id === group.action.reverts
        )
          throw new WorkspaceError('ACTION_INVALID');
      }
    }
    // Association/state projection reads one bounded page from the staging
    // backend; records are dropped after that page is committed.
    for (let offset = 0; offset < counts.items; offset += batchSize) {
      const batch = await store.read(async (tx) => {
        const result = [];
        for await (const stored of tx.items.iterate({
          offset,
          limit: batchSize,
        })) {
          let owner: ImportRecord | undefined;
          for await (const record of tx.imports.iterate())
            if (
              record.platform === stored.item.platform &&
              record.archives.includes(stored.item.provenance.archive) &&
              record.accounts.some(
                (account) => account.key === stored.item.account.key,
              )
            )
              if (
                !owner ||
                record.status === 'complete' ||
                owner.status !== 'complete'
              )
                owner = record;
          result.push({ stored, importId: owner?.id ?? '' });
        }
        return result;
      });
      await store.write(async (tx) => {
        for (const { stored, importId } of batch) {
          throwIfAborted(options.signal);
          await tx.items.put({
            ...stored,
            importId,
            metadataImportId: importId,
          });
          const head = (itemHeads.get(stored.item.id) ?? 0) % KNOWN_ITEM;
          await tx.state.put({
            itemId: stored.item.id,
            decision: decisionValues[head % STATE_KIND]!,
            outcome: outcomeValues[Math.floor(head / STATE_KIND)]!,
          });
        }
      });
    }
    await store.write(async (tx) => {
      throwIfAborted(options.signal);
      await tx.meta.set(meta);
      const runtime = await tx.runtime.get();
      await tx.runtime.set({
        revision: runtime.revision + 1,
        lastEventSeq: highSeq,
      });
    });
    return {
      meta,
      counts,
      lastEventSeq: highSeq,
      migratedFrom: version === 1 ? 1 : null,
    };
  } catch (error) {
    const code = options.signal?.aborted
      ? 'CANCELLED'
      : error instanceof WorkspaceError
        ? error.code
        : error instanceof Error && error.name === 'ZodError'
          ? 'BACKUP_INVALID_SCHEMA'
          : 'STORAGE';
    throw new RestoreFailure(code);
  }
}
