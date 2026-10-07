import { AssessmentSourceSchema } from '../model/index.ts';
import type { Assessment, AssessmentSource, Item } from '../model/index.ts';
import type { QueryFilter, QuerySort, ReviewRow } from './protocol.ts';
import type { StoredState } from './store.ts';
import { dayKey } from './time.ts';
import { compareAssessmentSources, ROW_SOURCE_LIMIT } from './row-sources.ts';

const KINDS = ['post', 'reply', 'quote', 'repost', 'comment'] as const;
const DECISIONS = ['undecided', 'keep', 'delete', 'later'] as const;
const OUTCOMES = ['unknown', 'deleted-by-user', 'skipped'] as const;
const SOURCES = ['rules', 'model', 'agent', 'fixture'] as const;
export interface CompactAssessment {
  risk: number;
  category: string;
  kind: Assessment['source']['kind'];
  sourceId: number;
}

/** Query-only columns: no full items, provenance, references or event records. */
export class QueryProjection {
  revision: number;
  readonly timeZone: string | null;
  readonly categories: readonly string[];
  readonly ids: string[] = [];
  readonly idIndex = new Map<string, number>();
  readonly accountIndex = new Map<string, number>();
  private readonly text: string[] = [];
  private readonly excerpt: string[] = [];
  private readonly createdIso: string[] = [];
  private capacity = 0;
  private account = new Uint32Array();
  private kind = new Uint8Array();
  private createdAt = new Float64Array();
  private likes = new Float64Array();
  private reposts = new Float64Array();
  private risk = new Int8Array();
  private categoryMask = new Uint32Array();
  private sourceMask = new Uint8Array();
  private firstSource = new Uint32Array();
  private moreSources = new Uint32Array();
  private decision = new Uint8Array();
  private outcome = new Uint8Array();
  private media = new Float64Array();
  private visible = new Uint8Array();
  private readonly orders = new Map<string, Uint32Array>();
  private readonly categoryOrder = new Map<number, string[]>();
  private readonly sourceTable: AssessmentSource[] = [];
  private readonly sourceIndex = new Map<string, number>();
  private readonly additionalSources = new Map<number, Uint32Array>();

  constructor(
    revision: number,
    categories: readonly string[],
    timeZone: string | null,
  ) {
    this.revision = revision;
    this.categories = [...categories];
    this.timeZone = timeZone;
  }
  get length(): number {
    return this.ids.length;
  }
  upsert(item: Item, visible: boolean): number {
    let index = this.idIndex.get(item.id);
    if (index === undefined) {
      index = this.ids.length;
      this.grow(index + 1);
      this.ids.push(item.id);
      this.idIndex.set(item.id, index);
      this.risk[index] = -1;
    }
    let account = this.accountIndex.get(item.account.key);
    if (account === undefined) {
      account = this.accountIndex.size;
      this.accountIndex.set(item.account.key, account);
    }
    this.account[index] = account;
    this.kind[index] = KINDS.indexOf(item.kind);
    this.createdAt[index] = Date.parse(item.createdAt);
    this.createdIso[index] = item.createdAt;
    this.likes[index] = item.engagement.likes ?? -1;
    this.reposts[index] = item.engagement.reposts ?? -1;
    this.media[index] = item.mediaCount ?? -1;
    this.visible[index] = visible ? 1 : 0;
    this.text[index] = item.text.normalize('NFC').toLowerCase();
    this.excerpt[index] = item.text.slice(0, 280);
    this.orders.clear();
    return index;
  }
  remove(id: string): void {
    const index = this.idIndex.get(id);
    if (index !== undefined) this.visible[index] = 0;
  }
  setState(state: StoredState): void {
    const index = this.idIndex.get(state.itemId);
    if (index === undefined) return;
    this.decision[index] = DECISIONS.indexOf(state.decision);
    this.outcome[index] = OUTCOMES.indexOf(state.outcome);
  }
  applyEvent(
    itemId: string,
    previous: string,
    value: string,
    domain: 'decision' | 'outcome',
  ): boolean {
    const index = this.idIndex.get(itemId);
    if (index === undefined) return false;
    const values = domain === 'decision' ? DECISIONS : OUTCOMES;
    const column = domain === 'decision' ? this.decision : this.outcome;
    if (values[column[index]!] !== previous) return false;
    column[index] = (values as readonly string[]).indexOf(value);
    return true;
  }
  internSource(input: AssessmentSource): number {
    const key = JSON.stringify([input.kind, input.name, input.version]);
    const existing = this.sourceIndex.get(key);
    if (existing !== undefined) return existing;
    const id = this.sourceTable.length + 1;
    this.sourceTable.push(AssessmentSourceSchema.parse(input));
    this.sourceIndex.set(key, id);
    return id;
  }
  setAssessments(
    index: number,
    assessments: Iterable<CompactAssessment>,
  ): void {
    let risk = -1,
      categories = 0,
      sources = 0;
    const categoryOrder = new Set<string>();
    const sourceIds: number[] = [];
    for (const assessment of assessments) {
      risk = Math.max(risk, assessment.risk);
      const category = this.categories.indexOf(assessment.category);
      categoryOrder.add(assessment.category);
      if (category >= 0) categories |= 1 << category;
      sources |= 1 << SOURCES.indexOf(assessment.kind);
      sourceIds.push(assessment.sourceId);
    }
    if (this.risk[index] !== risk) this.orders.clear();
    this.risk[index] = risk;
    this.categoryMask[index] = categories >>> 0;
    this.sourceMask[index] = sources;
    if (categoryOrder.size) this.categoryOrder.set(index, [...categoryOrder]);
    else this.categoryOrder.delete(index);
    sourceIds.sort((first, second) =>
      compareAssessmentSources(
        this.sourceTable[first - 1]!,
        this.sourceTable[second - 1]!,
      ),
    );
    this.firstSource[index] = sourceIds[0] ?? 0;
    this.moreSources[index] = Math.max(0, sourceIds.length - ROW_SOURCE_LIMIT);
    if (sourceIds.length > 1)
      this.additionalSources.set(
        index,
        Uint32Array.from(sourceIds.slice(1, ROW_SOURCE_LIMIT)),
      );
    else this.additionalSources.delete(index);
  }
  order(sort: QuerySort): Uint32Array {
    const key = JSON.stringify(sort);
    const prior = this.orders.get(key);
    if (prior) return prior;
    const indices = Array.from({ length: this.length }, (_, index) => index);
    indices.sort((first, second) => {
      for (const field of sort) {
        const a = this.sortValue(first, field.by),
          b = this.sortValue(second, field.by);
        if (a !== b)
          return (a < b ? -1 : 1) * (field.direction === 'asc' ? 1 : -1);
      }
      return this.ids[first]! < this.ids[second]!
        ? -1
        : this.ids[first]! > this.ids[second]!
          ? 1
          : 0;
    });
    if (this.orders.size >= 4)
      this.orders.delete(this.orders.keys().next().value!);
    const result = Uint32Array.from(indices);
    this.orders.set(key, result);
    return result;
  }
  predicate(
    accountKey: string,
    filter: QueryFilter,
    search: string,
    timeZone: string,
  ): (index: number) => boolean {
    const account = this.accountIndex.get(accountKey);
    const decisions = filter.decisions?.map((value) =>
      DECISIONS.indexOf(value),
    );
    const outcomes = filter.outcomes?.map((value) => OUTCOMES.indexOf(value));
    const kinds = filter.kinds?.map((value) => KINDS.indexOf(value));
    const categoryMask = filter.categories?.reduce((mask, value) => {
      const index = this.categories.indexOf(value);
      return index < 0 ? mask : mask | (1 << index);
    }, 0);
    const unmappedCategories = filter.categories?.filter(
      (category) => !this.categories.includes(category),
    );
    const sourceMask = filter.sources?.reduce(
      (mask, value) => mask | (1 << SOURCES.indexOf(value)),
      0,
    );
    const range = (
      value: number,
      bounds: {
        min: number | null;
        max: number | null;
        unknown: 'include' | 'exclude' | 'only';
      },
    ) =>
      value < 0
        ? bounds.unknown !== 'exclude'
        : bounds.unknown !== 'only' &&
          (bounds.min === null || value >= bounds.min) &&
          (bounds.max === null || value <= bounds.max);
    return (index) => {
      if (
        !this.visible[index] ||
        account === undefined ||
        this.account[index] !== account
      )
        return false;
      if (decisions && !decisions.includes(this.decision[index]!)) return false;
      if (outcomes && !outcomes.includes(this.outcome[index]!)) return false;
      if (kinds && !kinds.includes(this.kind[index]!)) return false;
      if (filter.risk && !range(this.risk[index]!, filter.risk)) return false;
      if (
        categoryMask !== undefined &&
        !(this.categoryMask[index]! & categoryMask) &&
        !unmappedCategories?.some((category) =>
          this.categoryOrder.get(index)?.includes(category),
        )
      )
        return false;
      if (sourceMask !== undefined && !(this.sourceMask[index]! & sourceMask))
        return false;
      if (filter.likes && !range(this.likes[index]!, filter.likes))
        return false;
      if (filter.reposts && !range(this.reposts[index]!, filter.reposts))
        return false;
      if (search && !this.text[index]!.includes(search)) return false;
      if (filter.dates) {
        const day = dayKey(this.createdIso[index]!, timeZone);
        if (
          (filter.dates.from && day < filter.dates.from) ||
          (filter.dates.to && day > filter.dates.to)
        )
          return false;
      }
      return true;
    };
  }
  values(index: number): {
    decision: StoredState['decision'];
    outcome: StoredState['outcome'];
  } {
    return {
      decision: DECISIONS[this.decision[index]!]!,
      outcome: OUTCOMES[this.outcome[index]!]!,
    };
  }
  row(index: number): ReviewRow {
    const sources: AssessmentSource[] = [];
    const first = this.firstSource[index]!;
    if (first) sources.push({ ...this.sourceTable[first - 1]! });
    for (const sourceId of this.additionalSources.get(index) ?? [])
      sources.push({ ...this.sourceTable[sourceId - 1]! });
    return {
      id: this.ids[index]!,
      kind: KINDS[this.kind[index]!]!,
      createdAt: this.createdIso[index]!,
      text: this.excerpt[index]!,
      highestRisk: this.risk[index]! < 0 ? null : this.risk[index]!,
      categories: [...(this.categoryOrder.get(index) ?? [])],
      sources,
      moreSources: this.moreSources[index]!,
      ...this.values(index),
      mediaCount: this.media[index]! < 0 ? null : this.media[index]!,
    };
  }
  private sortValue(
    index: number,
    by: QuerySort[number]['by'],
  ): string | number {
    if (by === 'id') return this.ids[index]!;
    if (by === 'createdAt') return this.createdAt[index]!;
    if (by === 'risk') return this.risk[index]!;
    return (by === 'likes' ? this.likes : this.reposts)[index]!;
  }
  private grow(required: number): void {
    if (required <= this.capacity) return;
    this.capacity = Math.max(1024, this.capacity * 2, required);
    const grow = <
      T extends Uint8Array | Uint32Array | Float64Array | Int8Array,
    >(
      column: T,
    ): T => {
      const next = new (column.constructor as { new (length: number): T })(
        this.capacity,
      );
      next.set(column);
      return next;
    };
    this.account = grow(this.account);
    this.kind = grow(this.kind);
    this.createdAt = grow(this.createdAt);
    this.likes = grow(this.likes);
    this.reposts = grow(this.reposts);
    this.risk = grow(this.risk);
    this.categoryMask = grow(this.categoryMask);
    this.sourceMask = grow(this.sourceMask);
    this.firstSource = grow(this.firstSource);
    this.moreSources = grow(this.moreSources);
    this.decision = grow(this.decision);
    this.outcome = grow(this.outcome);
    this.media = grow(this.media);
    this.visible = grow(this.visible);
  }
}
