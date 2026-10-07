import type { Item } from '../model/index.ts';
import { throwIfAborted } from '../archive/limits.ts';
import { WorkspaceError } from './errors.ts';
import { QueryFilterSchema, QuerySortSchema } from './protocol.ts';
import type { QueryFilter, QuerySort, ReviewRow } from './protocol.ts';
import type { DerivedItemState } from './state.ts';
import type { StoredState, WorkspaceStore } from './store.ts';
import { resolveTimeZone } from './time.ts';
import { QueryProjection } from './projection.ts';
import type { CompactAssessment } from './projection.ts';
import { currentRowSources } from './row-sources.ts';

export interface QuerySelection {
  ids: string[];
  revision: number;
}
export interface ReviewQuery {
  selection(queryId: string, generation: number): Promise<QuerySelection>;
  noteReviewCommitted?(change: ReviewProjectionChange): void;
}
export interface ReviewProjectionChange {
  previousRevision: number;
  revision: number;
  states: readonly StoredState[];
}
export interface QueryChange {
  revision: number;
  itemIds: readonly string[] | 'many';
}
export interface ProjectionRow {
  item: Item;
  state: DerivedItemState;
  highestRisk: number;
  categories: string[];
  sources: string[];
  search: string;
}
export function projectRow(item: Item, state: DerivedItemState): ProjectionRow {
  return {
    item,
    state,
    highestRisk: state.assessments.length
      ? Math.max(...state.assessments.map((assessment) => assessment.risk))
      : -1,
    categories: [
      ...new Set(state.assessments.map((assessment) => assessment.category)),
    ],
    sources: [
      ...new Set(state.assessments.map((assessment) => assessment.source.kind)),
    ],
    search: item.text.normalize('NFC').toLowerCase(),
  };
}
export function reviewRow(row: ProjectionRow): ReviewRow {
  return {
    id: row.item.id,
    kind: row.item.kind,
    createdAt: row.item.createdAt,
    text: row.item.text.slice(0, 280),
    highestRisk: row.highestRisk < 0 ? null : row.highestRisk,
    categories: row.categories,
    decision: row.state.decision,
    outcome: row.state.outcome,
    mediaCount: row.item.mediaCount,
    ...currentRowSources(row.state.assessments),
  };
}
export const DEFAULT_QUERY_SORT: QuerySort = [
  { by: 'risk', direction: 'desc' },
  { by: 'createdAt', direction: 'desc' },
  { by: 'id', direction: 'asc' },
];
export class QueryEngine implements ReviewQuery {
  private readonly store: WorkspaceStore;
  private readonly generations = new Map<string, number>();
  private readonly results = new Map<
    string,
    {
      generation: number;
      selection: QuerySelection;
      projection: QueryProjection;
      indices: Uint32Array;
      touchedAt: number;
    }
  >();
  private readonly yieldChunk: () => Promise<void>;
  private readonly now: () => number;
  private projection?: QueryProjection;
  private building?: Promise<QueryProjection>;
  private changes: Promise<void> = Promise.resolve();
  constructor(
    store: WorkspaceStore,
    options: { yieldChunk?: () => Promise<void>; now?: () => number } = {},
  ) {
    this.store = store;
    this.now = options.now ?? (() => Date.now());
    this.yieldChunk =
      options.yieldChunk ??
      (() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  /** Optional open-time warmup; query still builds and revision-checks on demand. */
  async prepareProjection(): Promise<void> {
    for (;;) {
      await this.changes;
      const revision = await this.store.read(
        async (tx) => (await tx.runtime.get()).revision,
      );
      const projection = await this.atRevision(revision);
      const current = await this.store.read(
        async (tx) => (await tx.runtime.get()).revision,
      );
      if (projection.revision === current && this.projection === projection)
        return;
    }
  }
  async query(input: {
    queryId: string;
    generation: number;
    accountKey: string;
    filter?: QueryFilter;
    sort?: QuerySort;
    search?: string;
    timeZone?: string;
    signal?: AbortSignal;
  }) {
    const filter = QueryFilterSchema.parse(input.filter ?? {});
    const sort = QuerySortSchema.parse(input.sort ?? DEFAULT_QUERY_SORT);
    if (!Number.isSafeInteger(input.generation) || input.generation < 0)
      throw new WorkspaceError('INVALID_QUERY');
    const prior = this.generations.get(input.queryId);
    if (prior !== undefined && input.generation <= prior)
      throw new WorkspaceError('CANCELLED');
    this.generations.set(input.queryId, input.generation);
    const search = (input.search ?? '').normalize('NFC').toLowerCase();
    for (;;) {
      await this.changes;
      this.checkScan(input);
      const revision = await this.store.read(
        async (tx) => (await tx.runtime.get()).revision,
      );
      const projection = await this.atRevision(revision);
      this.checkScan(input);
      const scanRevision = projection.revision;
      const timeZone = resolveTimeZone(
        input.timeZone,
        projection.timeZone,
      ).timeZone;
      const order = projection.order(sort);
      const matches = projection.predicate(
        input.accountKey,
        filter,
        search,
        timeZone,
      );
      const selected: number[] = [];
      const decisions = { keep: 0, delete: 0, later: 0, undecided: 0 };
      const outcomes = { 'deleted-by-user': 0, skipped: 0, unknown: 0 };
      for (let offset = 0; offset < order.length; offset += 5000) {
        this.checkScan(input);
        const end = Math.min(offset + 5000, order.length);
        for (let position = offset; position < end; position++) {
          const index = order[position]!;
          if (!matches(index)) continue;
          selected.push(index);
          const state = projection.values(index);
          decisions[state.decision]++;
          outcomes[state.outcome]++;
        }
        if (end < order.length) await this.yieldChunk();
      }
      this.checkScan(input);
      const current = await this.store.read(
        async (tx) => (await tx.runtime.get()).revision,
      );
      this.checkScan(input);
      // A commit during a yielded scan can mutate columns in place. Never
      // publish that mixed scan; retry against the current store revision.
      if (
        current !== scanRevision ||
        projection.revision !== scanRevision ||
        this.projection !== projection
      )
        continue;
      const selection = {
        ids: selected.map((index) => projection.ids[index]!),
        revision: scanRevision,
      };
      this.expireResults();
      this.results.delete(input.queryId);
      if (this.results.size >= 4)
        this.results.delete(this.results.keys().next().value!);
      this.results.set(input.queryId, {
        generation: input.generation,
        selection,
        projection,
        indices: Uint32Array.from(selected),
        touchedAt: this.now(),
      });
      return {
        queryId: input.queryId,
        generation: input.generation,
        total: selected.length,
        counts: { decisions, outcomes },
      };
    }
  }
  selection(queryId: string, generation: number): Promise<QuerySelection> {
    this.expireResults();
    const result = this.results.get(queryId);
    if (!result || result.generation !== generation)
      return Promise.reject(new WorkspaceError('QUERY_EXPIRED'));
    result.touchedAt = this.now();
    return Promise.resolve(structuredClone(result.selection));
  }
  window(
    queryId: string,
    generation: number,
    offset: number,
    limit: number,
  ): ReviewRow[] {
    this.expireResults();
    const result = this.results.get(queryId);
    if (!result || result.generation !== generation)
      throw new WorkspaceError('QUERY_EXPIRED');
    result.touchedAt = this.now();
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      throw new WorkspaceError('INVALID_QUERY');
    return [...result.indices.subarray(offset, offset + limit)].map((index) =>
      result.projection.row(index),
    );
  }
  release(queryId: string): void {
    this.results.delete(queryId);
    this.generations.delete(queryId);
  }
  private expireResults(): void {
    for (const [id, result] of this.results)
      if (this.now() - result.touchedAt >= 10 * 60_000) this.results.delete(id);
  }
  private checkScan(input: {
    queryId: string;
    generation: number;
    signal?: AbortSignal;
  }): void {
    throwIfAborted(input.signal);
    if (this.generations.get(input.queryId) !== input.generation)
      throw new WorkspaceError('CANCELLED');
  }
  private async atRevision(revision: number): Promise<QueryProjection> {
    if (this.projection?.revision === revision) return this.projection;
    if (this.building) {
      const built = await this.building;
      if (built.revision === revision) return built;
    }
    const build = this.store.read(async (tx) => {
      const meta = await tx.meta.get();
      const runtime = await tx.runtime.get();
      const result = new QueryProjection(
        runtime.revision,
        meta.settings.categories,
        meta.settings.timeZone,
      );
      const complete = new Set<string>();
      for await (const record of tx.imports.iterate())
        if (record.status === 'complete') complete.add(record.id);
      for await (const stored of tx.items.iterate())
        result.upsert(
          stored.item,
          !stored.importId || complete.has(stored.importId),
        );
      // Event logs remain the canonical decisions/outcomes. Derived backend
      // state is useful for sparse updates, but cannot redefine rebuild truth.
      for await (const event of tx.decisionEvents.iterate())
        if (
          !result.applyEvent(
            event.itemId,
            event.previous,
            event.value,
            'decision',
          )
        )
          throw new WorkspaceError('EVENT_CHAIN');
      for await (const event of tx.outcomeEvents.iterate())
        if (
          !result.applyEvent(
            event.itemId,
            event.previous,
            event.value,
            'outcome',
          )
        )
          throw new WorkspaceError('EVENT_CHAIN');
      const latest = new Map<number, Map<string, CompactAssessment>>();
      for await (const assessment of tx.assessments.iterate()) {
        const index = result.idIndex.get(assessment.itemId);
        if (index === undefined) throw new WorkspaceError('UNKNOWN_ITEM');
        const source = JSON.stringify([
          assessment.source.kind,
          assessment.source.name,
        ]);
        const current =
          latest.get(index) ?? new Map<string, CompactAssessment>();
        current.set(source, {
          risk: assessment.risk,
          category: assessment.category,
          kind: assessment.source.kind,
          sourceId: result.internSource(assessment.source),
        });
        latest.set(index, current);
      }
      for (const [index, assessments] of latest)
        result.setAssessments(index, assessments.values());
      return result;
    });
    this.building = build;
    try {
      const result = await build;
      this.projection = result;
      return result;
    } finally {
      if (this.building === build) this.building = undefined;
    }
  }
  /** Optional post-commit hint. Gaps and 'many' invalidate; correctness is revision-guarded. */
  noteChanged(change: QueryChange): Promise<void> {
    const operation = async () => {
      const projection = this.projection;
      if (!projection || change.revision <= projection.revision) return;
      if (
        change.itemIds === 'many' ||
        change.revision !== projection.revision + 1
      ) {
        this.projection = undefined;
        return;
      }
      const ids = new Set(change.itemIds);
      if (!ids.size) {
        this.projection = undefined;
        return;
      }
      const update = await this.store.read(async (tx) => {
        const runtime = await tx.runtime.get(),
          meta = await tx.meta.get();
        if (
          runtime.revision !== change.revision ||
          JSON.stringify(meta.settings.categories) !==
            JSON.stringify(projection.categories) ||
          meta.settings.timeZone !== projection.timeZone
        )
          return null;
        const items = await Promise.all(
          [...ids].map(async (id) => {
            const stored = await tx.items.get(id);
            const owner = stored?.importId
              ? await tx.imports.get(stored.importId)
              : undefined;
            return {
              id,
              stored,
              visible: !stored?.importId || owner?.status === 'complete',
            };
          }),
        );
        const states = new Map<string, StoredState>(
          [...ids].map((itemId) => [
            itemId,
            { itemId, decision: 'undecided', outcome: 'unknown' },
          ]),
        );
        for await (const event of tx.decisionEvents.iterate()) {
          const state = states.get(event.itemId);
          if (!state) continue;
          if (state.decision !== event.previous)
            throw new WorkspaceError('EVENT_CHAIN');
          state.decision = event.value;
        }
        for await (const event of tx.outcomeEvents.iterate()) {
          const state = states.get(event.itemId);
          if (!state) continue;
          if (state.outcome !== event.previous)
            throw new WorkspaceError('EVENT_CHAIN');
          state.outcome = event.value;
        }
        const latest = new Map<string, Map<string, CompactAssessment>>();
        for await (const assessment of tx.assessments.iterate()) {
          if (!ids.has(assessment.itemId)) continue;
          const sources =
            latest.get(assessment.itemId) ??
            new Map<string, CompactAssessment>();
          sources.set(
            JSON.stringify([assessment.source.kind, assessment.source.name]),
            {
              risk: assessment.risk,
              category: assessment.category,
              kind: assessment.source.kind,
              sourceId: projection.internSource(assessment.source),
            },
          );
          latest.set(assessment.itemId, sources);
        }
        return { items, latest, states };
      });
      if (
        !update ||
        this.projection !== projection ||
        projection.revision !== change.revision - 1
      ) {
        this.projection = undefined;
        return;
      }
      for (const { id, stored, visible } of update.items) {
        if (!stored) {
          projection.remove(id);
          continue;
        }
        const index = projection.upsert(stored.item, visible);
        projection.setState(update.states.get(id)!);
        projection.setAssessments(index, update.latest.get(id)?.values() ?? []);
      }
      projection.revision = change.revision;
    };
    const queued = this.changes.then(operation);
    this.changes = queued.catch(() => {
      this.projection = undefined;
    });
    return queued;
  }
  /** ReviewService calls this only after an acknowledged transaction commit. */
  noteReviewCommitted(change: ReviewProjectionChange): void {
    const projection = this.projection;
    if (
      !projection ||
      projection.revision !== change.previousRevision ||
      change.revision !== change.previousRevision + 1
    )
      return;
    if (change.states.some((state) => !projection.idIndex.has(state.itemId))) {
      this.projection = undefined;
      return;
    }
    for (const state of change.states) projection.setState(state);
    projection.revision = change.revision;
  }
}
