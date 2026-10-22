import type {
  WorkspaceV2,
  WorkspaceMeta,
  DecisionEvent,
} from '../model/index.ts';
import { feedCounts } from '../criteria/feed.ts';
import { currentChecks } from '../criteria/suggestions.ts';
import { criterionHash, definitionHash } from '../criteria/presets.ts';
import { canonicalJson } from './canonical.ts';
import { records } from './store.ts';
import type { WorkspaceStore, StoredState, ReadTransaction } from './store.ts';
import type { FeedCard, PlanCounts } from './protocol.ts';
import type { FeedTab } from '../criteria/schema.ts';
import { WorkspaceError } from './errors.ts';

/** Feed queries never need originals, context media or browser journals. */
export async function feedWorkspace(tx: ReadTransaction): Promise<WorkspaceV2> {
  const meta = await tx.meta.get();
  const complete = new Set(
    (await records(tx.imports))
      .filter((record) => record.status === 'complete')
      .map((record) => record.id),
  );
  const items = (await records(tx.items))
    .filter((stored) => !stored.importId || complete.has(stored.importId))
    .map((stored) => stored.item);
  const visible = new Set(items.map((item) => item.id));
  return {
    ...meta,
    // Visibility follows the first accepted import, not winning metadata provenance.
    imports: [],
    items,
    assessments: (await records(tx.assessments)).filter((record) =>
      visible.has(record.itemId),
    ),
    submissions: await records(tx.submissions),
    decisionEvents: (await records(tx.decisionEvents)).filter((record) =>
      visible.has(record.itemId),
    ),
    outcomeEvents: (await records(tx.outcomeEvents)).filter((record) =>
      visible.has(record.itemId),
    ),
    counts: {
      imports: 0,
      items: 0,
      assessments: 0,
      submissions: 0,
      decisionEvents: 0,
      outcomeEvents: 0,
    },
  };
}

export function planConfiguration(settings: WorkspaceMeta['settings']) {
  const selected = settings.criteria!;
  const criteria = selected.selected.map((id) => ({
    id,
    hash: criterionHash(id, settings),
  }));
  const keepRules = settings.keepRules ?? [];
  return {
    criteria,
    level: selected.level,
    keepRules,
    hash: definitionHash(
      canonicalJson({
        criteria,
        level: selected.level,
        keepRules,
        timeZone: settings.timeZone,
      }),
    ),
  };
}

function feedKey(accountKey: string, settings: WorkspaceMeta['settings']) {
  const { categories, criteria, keepRules, timeZone } = settings;
  return canonicalJson({
    accountKey,
    categories,
    criteria,
    keepRules,
    timeZone,
  });
}

export function projectFeed(workspace: WorkspaceV2, accountKey: string) {
  const result = feedCounts(workspace, accountKey);
  const checks = currentChecks(workspace);
  const hits: Record<string, number> = Object.fromEntries(
    workspace.settings.categories.map((id) => [id, 0]),
  );
  const held: Record<string, number> = Object.fromEntries(
    (workspace.settings.keepRules ?? []).map((rule) => [rule.id, 0]),
  );
  const sources = new Map<
    string,
    {
      kind: 'agent' | 'model' | 'rules' | 'fixture';
      name: string;
      count: number;
    }
  >();
  const itemSources = new Map<string, string[]>();
  const level = workspace.settings.criteria!.level;
  for (const [id, tab] of result.membership) {
    const seen = new Set<string>();
    for (const check of checks.get(id) ?? []) {
      if (
        check.status !== 'hit' ||
        !check.assessment ||
        check.assessment.risk < level ||
        check.criterion === 'harmless' ||
        check.criterion === 'unclear'
      )
        continue;
      if (!seen.has(check.criterion))
        hits[check.criterion] = (hits[check.criterion] ?? 0) + 1;
      seen.add(check.criterion);
    }
    for (const rule of result.holding.get(id) ?? [])
      held[rule] = (held[rule] ?? 0) + 1;
    {
      const seenSources = new Set<string>();
      for (const check of checks.get(id) ?? []) {
        if (
          !workspace.settings.criteria!.selected.includes(check.criterion) ||
          check.status !== 'hit' ||
          !check.assessment ||
          check.assessment.risk < level
        )
          continue;
        const key = JSON.stringify([check.source.kind, check.source.name]);
        if (seenSources.has(key)) continue;
        seenSources.add(key);
        const source = sources.get(key) ?? {
          kind: check.source.kind,
          name: check.source.name,
          count: 0,
        };
        if (tab === 'suggested') source.count++;
        sources.set(key, source);
      }
      itemSources.set(id, [...seenSources]);
    }
  }
  const order = workspace.items
    .filter((item) => result.membership.has(item.id))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    )
    .map((item) => item.id);
  return {
    ...result,
    hits,
    held,
    sources: [...sources.values()].filter((source) => source.count > 0),
    sourceCounters: sources,
    itemSources,
    order,
  };
}

/** One account projection per revision/configuration. Card bodies are read only in range. */
export class FeedQuery {
  private cache?: {
    key: string;
    revision: number;
    value: ReturnType<typeof projectFeed>;
  };
  private readonly store: WorkspaceStore;
  constructor(store: WorkspaceStore) {
    this.store = store;
  }
  private async current(accountKey: string) {
    return this.store.read(async (tx) => {
      const meta = await tx.meta.get();
      const runtime = await tx.runtime.get();
      const key = feedKey(accountKey, meta.settings);
      if (this.cache?.key === key && this.cache.revision === runtime.revision)
        return this.cache;
      const workspace = await feedWorkspace(tx);
      const value = projectFeed(workspace, accountKey);
      this.cache = { key, revision: runtime.revision, value };
      return this.cache;
    });
  }
  async counts(accountKey: string): Promise<PlanCounts> {
    const { value } = await this.current(accountKey);
    return structuredClone({
      tabs: value.tabs,
      hits: value.hits,
      held: value.held,
      unchecked: value.unchecked,
      popularThreshold: value.popularThreshold,
    });
  }
  async window(input: {
    accountKey: string;
    tab: FeedTab;
    offset?: number;
    anchor?: string;
    limit: number;
  }) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50 ||
      (input.offset !== undefined) === (input.anchor !== undefined) ||
      (input.offset !== undefined &&
        (!Number.isSafeInteger(input.offset) || input.offset < 0))
    )
      throw new WorkspaceError('INVALID_QUERY');
    for (;;) {
      const frozen = await this.current(input.accountKey);
      const projection = frozen.value;
      const revision = frozen.revision;
      const ids = projection.order.filter(
        (id) =>
          input.tab === 'all' || projection.membership.get(id) === input.tab,
      );
      const index = input.anchor === undefined ? -1 : ids.indexOf(input.anchor);
      const offset = input.offset ?? Math.max(index, 0);
      const result = await this.store.read(async (tx) => {
        if (
          (await tx.runtime.get()).revision !== revision ||
          feedKey(input.accountKey, (await tx.meta.get()).settings) !==
            frozen.key
        )
          return null;
        const selected = ids.slice(offset, offset + input.limit);
        const assessments = [];
        for await (const assessment of tx.assessments.iterate())
          if (selected.includes(assessment.itemId))
            assessments.push(assessment);
        const submissions = await records(tx.submissions);
        const settings = (await tx.meta.get()).settings;
        const checks = currentChecks({ assessments, submissions, settings });
        const events = new Map<string, DecisionEvent>();
        const actions = new Map<string, DecisionEvent>();
        for await (const event of tx.decisionEvents.iterate())
          if (selected.includes(event.itemId)) {
            events.set(event.itemId, event);
            actions.set(event.action.id, event);
          }
        const cards: FeedCard[] = [];
        for (const id of selected) {
          const stored = await tx.items.get(id);
          if (!stored) throw new WorkspaceError('UNKNOWN_ITEM');
          const state = await tx.state.get(id);
          const event = events.get(id) ?? null;
          let origin = event;
          const visited = new Set<string>();
          while (origin?.action.reverts && !visited.has(origin.action.id)) {
            visited.add(origin.action.id);
            origin = actions.get(origin.action.reverts) ?? null;
          }
          const plan = origin && (await tx.reviewPlans.get(origin.action.id));
          cards.push({
            item: stored.item,
            suggestions: [
              ...new Map(
                (checks.get(id) ?? []).flatMap((check) =>
                  check.assessment
                    ? [
                        [
                          check.assessment.assessmentId,
                          check.assessment,
                        ] as const,
                      ]
                    : [],
                ),
              ).values(),
            ],
            holdingRules: projection.holding.get(id) ?? [],
            decision: state?.decision ?? 'undecided',
            outcome: state?.outcome ?? 'unknown',
            decisionEvent: event,
            plan: plan ?? null,
          });
        }
        return {
          total: ids.length,
          anchorIndex: index < 0 ? null : index,
          cards,
        };
      });
      if (result) return result;
    }
  }
  noteCommitted(
    previousRevision: number,
    revision: number,
    states: readonly StoredState[],
  ) {
    const cache = this.cache;
    if (!cache || cache.revision !== previousRevision) return;
    // Decision-only updates preserve hit/rule counters; tab counters move once.
    for (const state of states) {
      const before = cache.value.membership.get(state.itemId);
      if (!before) continue;
      const after =
        state.decision === 'delete'
          ? 'marked'
          : state.decision === 'keep'
            ? 'kept'
            : state.decision === 'later'
              ? 'unclear'
              : cache.value.baseMembership.get(state.itemId)!;
      for (const key of cache.value.itemSources.get(state.itemId) ?? []) {
        const source = cache.value.sourceCounters.get(key)!;
        if (before === 'suggested') source.count--;
        if (after === 'suggested') source.count++;
      }
      if (before !== 'all') cache.value.tabs[before]--;
      if (after !== 'all') cache.value.tabs[after]++;
      cache.value.membership.set(state.itemId, after);
    }
    cache.revision = revision;
    cache.value.sources = [...cache.value.sourceCounters.values()].filter(
      (source) => source.count > 0,
    );
  }
}
