import type { WorkspaceMeta, WorkspaceV2 } from '../model/index.ts';
import type { FeedTab, FeedSort, KeepRule } from '../criteria/schema.ts';
import { currentChecks } from '../criteria/suggestions.ts';
import { deriveState } from './state.ts';
import { dayKey, resolveTimeZone } from './time.ts';
import type { StoredState } from './store.ts';

const TABS: readonly FeedTab[] = [
  'all',
  'suggested',
  'held',
  'kept',
  'unclear',
  'marked',
];
const DECISIONS = ['undecided', 'keep', 'delete', 'later'] as const;
const HIT = 1,
  UNCLEAR = 2,
  UNCLEAR_LABEL = 32;

/** Count inputs only. No item, assessment, workspace or event objects survive. */
export class CompactFeed {
  readonly ids: string[];
  private readonly indices: Map<string, number>;
  private readonly accounts: string[] = [];
  private readonly account: Uint32Array;
  private readonly created: Float64Array;
  private readonly likes: Float64Array;
  private readonly reposts: Float64Array;
  private readonly flags: Uint8Array;
  private readonly decisions: Uint8Array;
  private readonly order: Uint32Array;
  private readonly sortOrders = new Map<FeedSort, Uint32Array>();
  private readonly accountSortOptions = new Map<string, FeedSort[]>();
  private readonly criteria: string[] = [];
  private readonly checkOffset: Uint32Array;
  private readonly checkCriterion: Uint8Array | Uint32Array;
  private readonly checkValue: Uint8Array;
  private readonly thresholds: (number | null)[];
  constructor(workspace: WorkspaceV2) {
    const items = workspace.items;
    this.ids = items.map((item) => item.id);
    this.indices = new Map(this.ids.map((id, index) => [id, index]));
    this.account = new Uint32Array(items.length);
    this.created = new Float64Array(items.length);
    this.likes = new Float64Array(items.length);
    this.reposts = new Float64Array(items.length);
    this.flags = new Uint8Array(items.length);
    this.decisions = new Uint8Array(items.length);
    const states = deriveState({
      ...workspace,
      assessments: [],
      submissions: [],
    });
    const accounts = new Map<string, number>();
    const likes: number[][] = [];
    items.forEach((item, index) => {
      let account = accounts.get(item.account.key);
      if (account === undefined) {
        account = this.accounts.length;
        accounts.set(item.account.key, account);
        this.accounts.push(item.account.key);
        likes.push([]);
      }
      this.account[index] = account;
      this.created[index] = Date.parse(item.createdAt);
      this.likes[index] = item.engagement.likes ?? -1;
      this.reposts[index] = item.engagement.reposts ?? -1;
      let options = this.accountSortOptions.get(item.account.key);
      if (!options)
        this.accountSortOptions.set(
          item.account.key,
          (options = ['newest', 'oldest']),
        );
      if (item.engagement.likes !== null && !options.includes('likes'))
        options.push('likes');
      if (item.engagement.reposts !== null && !options.includes('reposts'))
        options.push('reposts');
      const eligible = item.platform === 'x' && item.kind !== 'repost';
      this.flags[index] = eligible ? 1 : 0;
      if (eligible && item.engagement.likes !== null)
        likes[account]!.push(item.engagement.likes);
      this.decisions[index] = DECISIONS.indexOf(states.get(item.id)!.decision);
    });
    this.thresholds = likes.map((values) => {
      values.sort((a, b) => b - a);
      return values.length
        ? Math.max(3, values[Math.max(0, Math.ceil(values.length / 10) - 1)]!)
        : null;
    });
    this.order = Uint32Array.from(
      items
        .map((_, index) => index)
        .sort(
          (a, b) =>
            items[b]!.createdAt.localeCompare(items[a]!.createdAt) ||
            items[a]!.id.localeCompare(items[b]!.id),
        ),
    );
    const checks = currentChecks(workspace);
    const count = [...checks.values()].reduce(
      (sum, values) => sum + values.length,
      0,
    );
    this.checkOffset = new Uint32Array(items.length + 1);
    const criterionCount = new Set(
      [...checks.values()].flatMap((values) =>
        values.map((check) => check.criterion),
      ),
    ).size;
    this.checkCriterion =
      criterionCount <= 256 ? new Uint8Array(count) : new Uint32Array(count);
    this.checkValue = new Uint8Array(count);
    const criteria = new Map<string, number>();
    let offset = 0;
    items.forEach((item, index) => {
      this.checkOffset[index] = offset;
      for (const check of checks.get(item.id) ?? []) {
        let criterion = criteria.get(check.criterion);
        if (criterion === undefined) {
          criterion = this.criteria.length;
          criteria.set(check.criterion, criterion);
          this.criteria.push(check.criterion);
        }
        this.checkCriterion[offset] = criterion;
        this.checkValue[offset++] =
          (check.status === 'hit'
            ? HIT
            : check.status === 'unclear'
              ? UNCLEAR
              : 0) |
          ((check.assessment ? check.assessment.risk + 1 : 0) << 2) |
          (check.assessment?.category === 'unclear' ? UNCLEAR_LABEL : 0);
      }
    });
    this.checkOffset[items.length] = offset;
    for (const options of this.accountSortOptions.values())
      options.sort(
        (a, b) =>
          ['newest', 'oldest', 'likes', 'reposts'].indexOf(a) -
          ['newest', 'oldest', 'likes', 'reposts'].indexOf(b),
      );
  }
  update(states: readonly StoredState[]) {
    for (const state of states) {
      const index = this.indices.get(state.itemId);
      if (index !== undefined)
        this.decisions[index] = DECISIONS.indexOf(state.decision);
    }
  }
  project(settings: WorkspaceMeta['settings'], accountKey: string) {
    const account = this.accounts.indexOf(accountKey);
    const config = settings.criteria!;
    const selected = new Set(config.selected);
    const rules = settings.keepRules ?? [];
    const zone = resolveTimeZone(null, settings.timeZone, 'UTC').timeZone;
    const membership = new Uint8Array(this.ids.length);
    const base = new Uint8Array(this.ids.length);
    const holding = new Uint16Array(this.ids.length);
    const tabs = {
      suggested: 0,
      held: 0,
      kept: 0,
      unclear: 0,
      marked: 0,
      all: 0,
    };
    const hits: Record<string, number> = Object.fromEntries(
      settings.categories.map((id) => [id, 0]),
    );
    const unchecked: Record<string, number> = Object.fromEntries(
      config.selected.map((id) => [id, 0]),
    );
    const held: Record<string, number> = Object.fromEntries(
      rules.map((rule) => [rule.id, 0]),
    );
    const selectedIndices = this.criteria.map((id) => selected.has(id));
    const eligibleCriteria = this.criteria.map(
      (id) => id !== 'harmless' && id !== 'unclear',
    );
    for (let index = 0; index < this.ids.length; index++) {
      if (this.account[index] !== account) continue;
      tabs.all++;
      const seen = new Set<number>(),
        hitCriteria = new Set<number>();
      let hit = false,
        unclear = false;
      for (
        let check = this.checkOffset[index]!;
        check < this.checkOffset[index + 1]!;
        check++
      ) {
        const criterion = this.checkCriterion[check]!,
          value = this.checkValue[check]!;
        seen.add(criterion);
        const status = value & 3,
          risk = ((value >> 2) & 7) - 1;
        unclear ||= status === UNCLEAR || !!(value & UNCLEAR_LABEL);
        if (status !== HIT || risk < config.level) continue;
        if (eligibleCriteria[criterion]) hitCriteria.add(criterion);
        if (selectedIndices[criterion]) {
          if (eligibleCriteria[criterion]) hit = true;
        }
      }
      for (const criterion of config.selected) {
        if (!seen.has(this.criteria.indexOf(criterion)))
          unchecked[criterion] = (unchecked[criterion] ?? 0) + 1;
      }
      for (const criterion of hitCriteria)
        hits[this.criteria[criterion]!] =
          (hits[this.criteria[criterion]!] ?? 0) + 1;
      let mask = 0;
      if (hit)
        rules.forEach((rule, bit) => {
          if (this.holds(index, rule, zone)) {
            mask |= 1 << bit;
            held[rule.id] = (held[rule.id] ?? 0) + 1;
          }
        });
      holding[index] = mask;
      base[index] = hit ? (mask ? 2 : 1) : unclear ? 4 : 0;
      membership[index] =
        this.decisions[index] === 2
          ? 5
          : this.decisions[index] === 1
            ? 3
            : this.decisions[index] === 3
              ? 4
              : base[index]!;
      const tab = TABS[membership[index]!]!;
      if (tab !== 'all') tabs[tab]++;
    }
    return {
      tabs,
      hits,
      unchecked,
      held,
      popularThreshold: account < 0 ? null : this.thresholds[account]!,
      membership,
      base,
      holding,
      account,
      rules: rules.map((rule) => rule.id),
    };
  }
  private holds(index: number, rule: KeepRule, zone: string) {
    if (!rule.enabled) return false;
    if (rule.kind === 'created-from')
      return (
        dayKey(new Date(this.created[index]!).toISOString(), zone) >= rule.date
      );
    if (!(this.flags[index]! & 1)) return false;
    if (rule.kind === 'top-liked-tenth') {
      const threshold = this.thresholds[this.account[index]!]!;
      return threshold !== null && this.likes[index]! >= threshold;
    }
    const value =
      rule.kind === 'likes-at-least'
        ? this.likes[index]!
        : this.reposts[index]!;
    return value < 0 ? rule.alsoWhenUnknown : value >= rule.count;
  }
  sortOptions(accountKey: string): FeedSort[] {
    return [
      ...(this.accountSortOptions.get(accountKey) ?? ['newest', 'oldest']),
    ];
  }
  private sorted(sort: FeedSort) {
    if (sort === 'newest') return this.order;
    const cached = this.sortOrders.get(sort);
    if (cached) return cached;
    const order = Uint32Array.from(this.order).sort((a, b) => {
      if (sort === 'oldest')
        return (
          this.created[a]! - this.created[b]! ||
          this.ids[a]!.localeCompare(this.ids[b]!)
        );
      const column = sort === 'likes' ? this.likes : this.reposts;
      return (
        column[b]! - column[a]! ||
        this.created[b]! - this.created[a]! ||
        this.ids[a]!.localeCompare(this.ids[b]!)
      );
    });
    this.sortOrders.set(sort, order);
    return order;
  }
  window(
    projection: ReturnType<CompactFeed['project']>,
    tab: FeedTab,
    sort: FeedSort = 'newest',
  ) {
    const code = TABS.indexOf(tab),
      ids: string[] = [];
    for (const index of this.sorted(sort))
      if (
        this.account[index] === projection.account &&
        (tab === 'all' || projection.membership[index] === code)
      )
        ids.push(this.ids[index]!);
    return ids;
  }
  holding(projection: ReturnType<CompactFeed['project']>, id: string) {
    const index = this.indices.get(id);
    if (index === undefined) return [];
    return projection.rules.filter(
      (_, bit) => !!(projection.holding[index]! & (1 << bit)),
    );
  }
  committed(
    projection: ReturnType<CompactFeed['project']>,
    states: readonly StoredState[],
  ) {
    this.update(states);
    for (const state of states) {
      const index = this.indices.get(state.itemId);
      if (index === undefined || this.account[index] !== projection.account)
        continue;
      const before = TABS[projection.membership[index]!]!;
      const after =
        state.decision === 'delete'
          ? 'marked'
          : state.decision === 'keep'
            ? 'kept'
            : state.decision === 'later'
              ? 'unclear'
              : TABS[projection.base[index]!]!;
      if (before !== 'all') projection.tabs[before]--;
      if (after !== 'all') projection.tabs[after]++;
      projection.membership[index] = TABS.indexOf(after);
    }
  }
}
