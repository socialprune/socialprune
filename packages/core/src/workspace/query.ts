import type { Assessment, Item } from '../model/index.ts';
import { throwIfAborted } from '../archive/limits.ts';
import { WorkspaceError } from './errors.ts';
import { QueryFilterSchema, QuerySortSchema } from './protocol.ts';
import type { QueryFilter, QuerySort, ReviewRow } from './protocol.ts';
import { deriveState } from './state.ts';
import type { DerivedItemState } from './state.ts';
import { readWorkspace, records } from './store.ts';
import type { WorkspaceStore } from './store.ts';
import { dayKey, resolveTimeZone } from './time.ts';

export interface QuerySelection {
  ids: string[];
  revision: number;
}
export interface ReviewQuery {
  selection(queryId: string, generation: number): Promise<QuerySelection>;
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
  };
}
function rangeMatch(
  value: number | null,
  range: {
    min: number | null;
    max: number | null;
    unknown: 'include' | 'exclude' | 'only';
  },
): boolean {
  if (value === null) return range.unknown !== 'exclude';
  return (
    range.unknown !== 'only' &&
    (range.min === null || value >= range.min) &&
    (range.max === null || value <= range.max)
  );
}
function matches(
  row: ProjectionRow,
  filter: QueryFilter,
  search: string,
  timeZone: string,
): boolean {
  if (filter.decisions && !filter.decisions.includes(row.state.decision))
    return false;
  if (filter.outcomes && !filter.outcomes.includes(row.state.outcome))
    return false;
  if (filter.kinds && !filter.kinds.includes(row.item.kind)) return false;
  if (
    filter.risk &&
    !rangeMatch(row.highestRisk < 0 ? null : row.highestRisk, filter.risk)
  )
    return false;
  if (
    filter.categories &&
    !row.categories.some((category) => filter.categories!.includes(category))
  )
    return false;
  if (
    filter.sources &&
    !row.sources.some((source) =>
      filter.sources!.includes(source as Assessment['source']['kind']),
    )
  )
    return false;
  if (filter.likes && !rangeMatch(row.item.engagement.likes, filter.likes))
    return false;
  if (
    filter.reposts &&
    !rangeMatch(row.item.engagement.reposts, filter.reposts)
  )
    return false;
  if (filter.dates) {
    const day = dayKey(row.item.createdAt, timeZone);
    if (
      (filter.dates.from && day < filter.dates.from) ||
      (filter.dates.to && day > filter.dates.to)
    )
      return false;
  }
  return !search || row.search.includes(search);
}
function compare(a: ProjectionRow, b: ProjectionRow, sort: QuerySort): number {
  for (const order of sort) {
    const value = (row: ProjectionRow): number | string => {
      if (order.by === 'risk') return row.highestRisk;
      if (order.by === 'id') return row.item.id;
      if (order.by === 'createdAt') return Date.parse(row.item.createdAt);
      return row.item.engagement[order.by] ?? -1;
    };
    const first = value(a),
      second = value(b);
    if (first === second) continue;
    return (first < second ? -1 : 1) * (order.direction === 'asc' ? 1 : -1);
  }
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
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
      rows: ProjectionRow[];
      touchedAt: number;
    }
  >();
  private readonly yieldChunk: () => Promise<void>;
  private readonly now: () => number;
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
    const snapshot = await this.store.read(async (tx) => ({
      workspace: await readWorkspace(tx),
      runtime: await tx.runtime.get(),
      stored: await records(tx.items),
    }));
    const states = deriveState(snapshot.workspace);
    const complete = new Set(
      snapshot.workspace.imports
        .filter((record) => record.status === 'complete')
        .map((record) => record.id),
    );
    const timeZone = resolveTimeZone(
      input.timeZone,
      snapshot.workspace.settings.timeZone,
    ).timeZone;
    const search = (input.search ?? '').normalize('NFC').toLowerCase();
    const selected: ProjectionRow[] = [];
    for (let offset = 0; offset < snapshot.stored.length; offset += 5000) {
      throwIfAborted(input.signal);
      if (this.generations.get(input.queryId) !== input.generation)
        throw new WorkspaceError('CANCELLED');
      for (const { item, importId } of snapshot.stored.slice(
        offset,
        offset + 5000,
      )) {
        if (
          (importId && !complete.has(importId)) ||
          item.account.key !== input.accountKey
        )
          continue;
        const row = projectRow(item, states.get(item.id)!);
        if (matches(row, filter, search, timeZone)) selected.push(row);
      }
      if (offset + 5000 < snapshot.stored.length) await this.yieldChunk();
    }
    throwIfAborted(input.signal);
    if (this.generations.get(input.queryId) !== input.generation)
      throw new WorkspaceError('CANCELLED');
    selected.sort((a, b) => compare(a, b, sort));
    const selection = {
      ids: selected.map((row) => row.item.id),
      revision: snapshot.runtime.revision,
    };
    this.expireResults();
    this.results.delete(input.queryId);
    if (this.results.size >= 4)
      this.results.delete(this.results.keys().next().value!);
    this.results.set(input.queryId, {
      generation: input.generation,
      selection,
      rows: selected,
      touchedAt: this.now(),
    });
    const decisions = { keep: 0, delete: 0, later: 0, undecided: 0 };
    const outcomes = { 'deleted-by-user': 0, skipped: 0, unknown: 0 };
    for (const row of selected) {
      decisions[row.state.decision]++;
      outcomes[row.state.outcome]++;
    }
    return {
      queryId: input.queryId,
      generation: input.generation,
      total: selected.length,
      counts: { decisions, outcomes },
    };
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
    return result.rows.slice(offset, offset + limit).map(reviewRow);
  }
  release(queryId: string): void {
    this.results.delete(queryId);
    this.generations.delete(queryId);
  }
  private expireResults(): void {
    for (const [id, result] of this.results)
      if (this.now() - result.touchedAt >= 10 * 60_000) this.results.delete(id);
  }
}
