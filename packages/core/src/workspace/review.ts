import { z } from 'zod';
import { DecisionValueSchema, OutcomeValueSchema } from '../model/index.ts';
import type {
  DecisionEvent,
  DecisionValue,
  Assessment,
  OutcomeEvent,
  OutcomeValue,
} from '../model/index.ts';
import { canonicalJson, contentHash } from './canonical.ts';
import { WorkspaceError } from './errors.ts';
import type { WorkspaceErrorCode } from './errors.ts';
import { projectRow, reviewRow } from './query.ts';
import type { ReviewQuery, ReviewProjectionChange } from './query.ts';
import type { BulkPreview } from './protocol.ts';
import { PreviewBulkRequestSchema } from './protocol.ts';
import { records } from './store.ts';
import type {
  ReviewCommandResult,
  StoredState,
  WorkspaceStore,
  WriteTransaction,
} from './store.ts';

type Event = DecisionEvent | OutcomeEvent;
interface FrozenPreview {
  payload: BulkPreview;
  expected: Map<string, DecisionValue>;
  ids: string[];
}
interface CommandInput {
  commandId: string;
  itemIds: string[];
  value: DecisionValue | OutcomeValue;
  expected: Record<string, DecisionValue | OutcomeValue>;
}
interface ActionGroup {
  id: string;
  events: Event[];
  domain: 'decision' | 'outcome';
}

/** Human-only capability. Never import this from ordinary CLI command modules. */
export class ReviewService {
  private readonly store: WorkspaceStore;
  private readonly query: ReviewQuery;
  private readonly via: 'web-review' | 'local-review';
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly previews = new Map<string, FrozenPreview>();
  constructor(
    store: WorkspaceStore,
    options: {
      query: ReviewQuery;
      via: 'web-review' | 'local-review';
      now?: () => Date;
      uuid?: () => string;
    },
  ) {
    if (options.via !== 'web-review' && options.via !== 'local-review')
      throw new WorkspaceError('INVALID_REQUEST');
    this.store = store;
    this.query = options.query;
    this.via = options.via;
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }
  decide(
    input: CommandInput & { value: DecisionValue },
  ): Promise<ReviewCommandResult> {
    return this.change(input, 'decision');
  }
  outcome(
    input: CommandInput & { value: OutcomeValue },
  ): Promise<ReviewCommandResult> {
    return this.change(input, 'outcome');
  }
  private validateCommand(
    input: CommandInput,
    domain: 'decision' | 'outcome',
  ): void {
    const value =
      domain === 'decision' ? DecisionValueSchema : OutcomeValueSchema;
    const schema = z.strictObject({
      commandId: z.string().min(1),
      itemIds: z.array(z.string().min(1)).min(1).max(1000),
      value,
      expected: z.record(z.string().min(1), value),
    });
    if (
      !schema.safeParse(input).success ||
      new Set(input.itemIds).size !== input.itemIds.length ||
      Object.keys(input.expected).length !== input.itemIds.length ||
      input.itemIds.some((id) => !Object.hasOwn(input.expected, id))
    )
      throw new WorkspaceError('INVALID_REQUEST');
  }
  private async command(
    commandId: string,
    body: unknown,
    operation: (
      tx: WriteTransaction,
      time: string,
      actionId: string,
      projectionChange: (change: ReviewProjectionChange) => void,
    ) => Promise<ReviewCommandResult>,
  ): Promise<ReviewCommandResult> {
    if (!commandId) throw new WorkspaceError('INVALID_REQUEST');
    const hash = await contentHash(canonicalJson(body));
    const time = this.now().toISOString();
    const actionId = this.uuid();
    let projectionChange: ReviewProjectionChange | undefined;
    let committed: ReviewCommandResult;
    try {
      committed = await this.store.write(async (tx) => {
        const prior = await tx.commands.get(commandId);
        if (prior) {
          if (prior.contentHash !== hash)
            return this.rejected(commandId, 'EVENT_CONFLICT');
          return prior.result;
        }
        const result = await operation(tx, time, actionId, (change) => {
          projectionChange = change;
        });
        await tx.commands.add({ commandId, contentHash: hash, result });
        return result;
      });
    } catch (error) {
      return this.rejected(
        commandId,
        error instanceof WorkspaceError ? error.code : 'STORAGE',
      );
    }
    if (projectionChange) {
      try {
        this.query.noteReviewCommitted?.(projectionChange);
      } catch {
        console.warn('QUERY_PROJECTION_UPDATE_FAILED', actionId);
      }
    }
    return committed;
  }
  private rejected(
    commandId: string,
    code: WorkspaceErrorCode,
    changedSince?: number,
  ): ReviewCommandResult {
    return {
      type: 'rejected',
      commandId,
      code,
      ...(changedSince === undefined ? {} : { changedSince }),
    };
  }
  private async change(
    input: CommandInput,
    domain: 'decision' | 'outcome',
  ): Promise<ReviewCommandResult> {
    this.validateCommand(input, domain);
    return this.command(
      input.commandId,
      { type: domain, ...input },
      async (tx, time, actionId, projectionChange) => {
        const states = new Map<string, StoredState>();
        for (const id of input.itemIds) {
          const item = await tx.items.get(id);
          if (!item) return this.rejected(input.commandId, 'UNKNOWN_ITEM');
          const record = item.importId
            ? await tx.imports.get(item.importId)
            : undefined;
          if (record?.status === 'incomplete')
            return this.rejected(input.commandId, 'IMPORT_INCOMPLETE');
          const state = (await tx.state.get(id)) ?? {
            itemId: id,
            decision: 'undecided',
            outcome: 'unknown',
          };
          if (state[domain] !== input.expected[id])
            return this.rejected(input.commandId, 'STALE');
          states.set(id, state);
        }
        const changed = input.itemIds.filter(
          (id) => states.get(id)![domain] !== input.value,
        );
        return this.append(
          tx,
          input.commandId,
          changed,
          states,
          input.value,
          domain,
          'single',
          null,
          time,
          actionId,
          undefined,
          projectionChange,
        );
      },
    );
  }
  private async append(
    tx: WriteTransaction,
    commandId: string,
    ids: string[],
    states: Map<string, StoredState>,
    value:
      DecisionValue | OutcomeValue | Map<string, DecisionValue | OutcomeValue>,
    domain: 'decision' | 'outcome',
    kind: 'single' | 'bulk' | 'undo' | 'redo',
    reverts: string | null,
    time: string,
    actionId: string,
    skipped?: number,
    projectionChange?: (change: ReviewProjectionChange) => void,
  ): Promise<ReviewCommandResult> {
    const runtime = await tx.runtime.get();
    if (!ids.length)
      return {
        type: 'committed',
        commandId,
        actionId: null,
        revision: runtime.revision,
        changed: 0,
        ...(skipped === undefined ? {} : { skipped }),
      };
    const action = {
      id: actionId,
      kind: kind === 'single' && ids.length > 1 ? ('bulk' as const) : kind,
      size: ids.length,
      reverts,
    };
    const decisionEvents: DecisionEvent[] = [];
    const outcomeEvents: OutcomeEvent[] = [];
    let seq = runtime.lastEventSeq;
    const projected: StoredState[] = [];
    for (const id of ids) {
      const state = states.get(id)!;
      const next = value instanceof Map ? value.get(id)! : value;
      const common = {
        eventId: `${actionId}:${domain}:${encodeURIComponent(id)}`,
        seq: ++seq,
        itemId: id,
        source: { kind: 'human' as const, via: this.via },
        action,
      };
      if (domain === 'decision') {
        decisionEvents.push({
          ...common,
          previous: state.decision,
          value: next as DecisionValue,
          decidedAt: time,
        });
        await tx.state.put({ ...state, decision: next as DecisionValue });
        projected.push({ ...state, decision: next as DecisionValue });
      } else {
        outcomeEvents.push({
          ...common,
          previous: state.outcome,
          value: next as OutcomeValue,
          recordedAt: time,
        });
        await tx.state.put({ ...state, outcome: next as OutcomeValue });
        projected.push({ ...state, outcome: next as OutcomeValue });
      }
    }
    if (decisionEvents.length) await tx.decisionEvents.append(decisionEvents);
    if (outcomeEvents.length) await tx.outcomeEvents.append(outcomeEvents);
    await tx.runtime.set({ revision: runtime.revision + 1, lastEventSeq: seq });
    const meta = await tx.meta.get();
    await tx.meta.set({ ...meta, updatedAt: time });
    projectionChange?.({
      previousRevision: runtime.revision,
      revision: runtime.revision + 1,
      states: projected,
    });
    return {
      type: 'committed',
      commandId,
      actionId,
      revision: runtime.revision + 1,
      changed: ids.length,
      ...(skipped === undefined ? {} : { skipped }),
    };
  }
  async previewBulk(input: {
    pageId: string;
    previewId: string;
    queryId: string;
    generation: number;
    value: DecisionValue;
    overwrite: DecisionValue[];
    itemIds?: string[];
  }): Promise<BulkPreview> {
    if (
      !input.pageId ||
      !input.previewId ||
      !DecisionValueSchema.safeParse(input.value).success ||
      !input.overwrite.length ||
      input.overwrite.some(
        (value) => !DecisionValueSchema.safeParse(value).success,
      )
    )
      throw new WorkspaceError('INVALID_REQUEST');
    const { itemIds, ...previewInput } = input;
    if (!PreviewBulkRequestSchema.shape.itemIds.safeParse(itemIds).success)
      throw new WorkspaceError('INVALID_REQUEST');
    const requestedIds = itemIds === undefined ? undefined : new Set(itemIds);
    const selection = await this.query.selection(
      input.queryId,
      input.generation,
    );
    const frozenIds =
      requestedIds === undefined
        ? selection.ids
        : selection.ids.filter((id) => requestedIds.has(id));
    const frozen = await this.store.read(async (tx) => {
      const runtime = await tx.runtime.get();
      if (runtime.revision !== selection.revision)
        throw new WorkspaceError('STALE_PREVIEW');
      const expected = new Map<string, DecisionValue>();
      const byCurrentValue = { keep: 0, delete: 0, later: 0, undecided: 0 };
      const sample = [];
      const sampleIds = new Set(frozenIds.slice(0, 20));
      const sampleAssessments = new Map<string, Map<string, Assessment>>();
      for await (const assessment of tx.assessments.iterate()) {
        if (!sampleIds.has(assessment.itemId)) continue;
        const sources =
          sampleAssessments.get(assessment.itemId) ??
          new Map<string, Assessment>();
        sources.set(
          JSON.stringify([assessment.source.kind, assessment.source.name]),
          assessment,
        );
        sampleAssessments.set(assessment.itemId, sources);
      }
      let willChange = 0;
      for (const id of frozenIds) {
        const stored = await tx.items.get(id);
        if (!stored) throw new WorkspaceError('UNKNOWN_ITEM');
        const state = (await tx.state.get(id)) ?? {
          itemId: id,
          decision: 'undecided' as const,
          outcome: 'unknown' as const,
        };
        expected.set(id, state.decision);
        byCurrentValue[state.decision]++;
        if (
          input.overwrite.includes(state.decision) &&
          state.decision !== input.value
        )
          willChange++;
        if (sample.length < 20)
          sample.push(
            reviewRow(
              projectRow(stored.item, {
                ...state,
                assessments: [...(sampleAssessments.get(id)?.values() ?? [])],
              }),
            ),
          );
      }
      return {
        expected,
        byCurrentValue,
        sample,
        willChange,
        revision: runtime.revision,
      };
    });
    this.expirePreviews();
    for (const [id, preview] of this.previews)
      if (preview.payload.pageId === input.pageId) this.previews.delete(id);
    if (this.previews.has(input.previewId))
      throw new WorkspaceError('INVALID_REQUEST');
    if (this.previews.size >= 4)
      this.previews.delete(this.previews.keys().next().value!);
    const payload: BulkPreview = {
      ...previewInput,
      overwrite: [...input.overwrite],
      total: frozenIds.length,
      unchanged: frozenIds.length - frozen.willChange,
      willChange: frozen.willChange,
      byCurrentValue: frozen.byCurrentValue,
      sample: frozen.sample,
      revision: frozen.revision,
      expiresAt: new Date(this.now().getTime() + 10 * 60_000).toISOString(),
      ...(requestedIds === undefined
        ? {}
        : {
            selection: {
              requested: requestedIds.size,
              inView: frozenIds.length,
              notInView: requestedIds.size - frozenIds.length,
            },
          }),
    };
    this.previews.set(input.previewId, {
      payload,
      expected: frozen.expected,
      ids: [...frozenIds],
    });
    return structuredClone(payload);
  }
  releasePreview(pageId: string, previewId: string): void {
    if (this.previews.get(previewId)?.payload.pageId === pageId)
      this.previews.delete(previewId);
  }
  closeSession(): void {
    this.previews.clear();
  }
  private expirePreviews(): void {
    for (const [id, preview] of this.previews)
      if (Date.parse(preview.payload.expiresAt) <= this.now().getTime())
        this.previews.delete(id);
  }
  async confirmBulk(input: {
    commandId: string;
    pageId: string;
    previewId: string;
  }): Promise<ReviewCommandResult> {
    const preview = this.previews.get(input.previewId);
    const result = await this.command(
      input.commandId,
      { type: 'confirmBulk', ...input },
      async (tx, time, actionId, projectionChange) => {
        if (
          !preview ||
          this.previews.get(input.previewId) !== preview ||
          preview.payload.pageId !== input.pageId ||
          Date.parse(preview.payload.expiresAt) <= this.now().getTime()
        )
          return this.rejected(input.commandId, 'PREVIEW_EXPIRED');
        const states = new Map<string, StoredState>();
        let changedSince = 0;
        for (const id of preview.ids) {
          const state = await tx.state.get(id);
          if (!state || state.decision !== preview.expected.get(id))
            changedSince++;
          if (state) states.set(id, state);
        }
        if (changedSince)
          return this.rejected(input.commandId, 'STALE_PREVIEW', changedSince);
        const ids = preview.ids.filter(
          (id) =>
            preview.payload.overwrite.includes(states.get(id)!.decision) &&
            states.get(id)!.decision !== preview.payload.value,
        );
        return this.append(
          tx,
          input.commandId,
          ids,
          states,
          preview.payload.value,
          'decision',
          'bulk',
          null,
          time,
          actionId,
          undefined,
          projectionChange,
        );
      },
    );
    if (
      preview?.payload.pageId === input.pageId &&
      this.previews.get(input.previewId) === preview
    )
      this.previews.delete(input.previewId);
    return result;
  }
  private async groups(tx: WriteTransaction): Promise<ActionGroup[]> {
    const events = [
      ...(await records(tx.decisionEvents)),
      ...(await records(tx.outcomeEvents)),
    ];
    const groups = new Map<string, ActionGroup>();
    for (const event of events.sort((a, b) => a.seq - b.seq)) {
      const group = groups.get(event.action.id) ?? {
        id: event.action.id,
        events: [],
        domain:
          'decidedAt' in event ? ('decision' as const) : ('outcome' as const),
      };
      group.events.push(event);
      groups.set(group.id, group);
    }
    // Portable sequence alone determines cross-log order. Receipts only guard
    // duplicate commands and are deliberately absent from a backup document.
    return [...groups.values()];
  }
  undo(commandId: string): Promise<ReviewCommandResult> {
    return this.reverse(commandId, 'undo');
  }
  redo(commandId: string): Promise<ReviewCommandResult> {
    return this.reverse(commandId, 'redo');
  }
  private reverse(
    commandId: string,
    kind: 'undo' | 'redo',
  ): Promise<ReviewCommandResult> {
    return this.command(
      commandId,
      { type: kind, commandId },
      async (tx, time, actionId, projectionChange) => {
        const groups = await this.groups(tx);
        const undo: ActionGroup[] = [],
          redo: ActionGroup[] = [];
        for (const group of groups) {
          const action = group.events[0]!.action;
          if (action.kind === 'single' || action.kind === 'bulk') {
            undo.push(group);
            redo.length = 0;
          } else if (action.kind === 'undo') {
            const index = undo.findIndex(
              (entry) => entry.id === action.reverts,
            );
            if (index >= 0) undo.splice(index, 1);
            redo.push(group);
          } else if (action.kind === 'redo') {
            const index = redo.findIndex(
              (entry) => entry.id === action.reverts,
            );
            if (index >= 0) redo.splice(index, 1);
            undo.push(group);
          }
        }
        const target = (kind === 'undo' ? undo : redo).at(-1);
        if (!target)
          return this.rejected(
            commandId,
            kind === 'undo' ? 'NOTHING_TO_UNDO' : 'NOTHING_TO_REDO',
          );
        const values = new Map<string, DecisionValue | OutcomeValue>();
        const states = new Map<string, StoredState>();
        let skipped = 0;
        for (const event of target.events) {
          const state = await tx.state.get(event.itemId);
          if (!state || state[target.domain] !== event.value) {
            skipped++;
            continue;
          }
          states.set(event.itemId, state);
          values.set(event.itemId, event.previous);
        }
        return this.append(
          tx,
          commandId,
          [...values.keys()],
          states,
          values,
          target.domain,
          kind,
          target.id,
          time,
          actionId,
          skipped,
          projectionChange,
        );
      },
    );
  }
  async history(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new WorkspaceError('INVALID_REQUEST');
    return this.store.read(async (tx) => {
      const groups = await this.groups(tx as WriteTransaction);
      return groups
        .reverse()
        .slice(0, limit)
        .map((group) => {
          const event = group.events[0]!;
          return {
            actionId: group.id,
            kind: event.action.kind,
            value: event.value,
            size: group.events.length,
            time: 'decidedAt' in event ? event.decidedAt : event.recordedAt,
          };
        });
    });
  }
}
