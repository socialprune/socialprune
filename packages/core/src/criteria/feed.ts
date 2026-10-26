import type { WorkspaceV2 } from '../model/index.ts';
import { deriveState } from '../workspace/state.ts';
import { popularityThreshold } from '../workspace/popular.ts';
import { resolveTimeZone } from '../workspace/time.ts';
import { currentChecks } from './suggestions.ts';
export { currentChecks } from './suggestions.ts';
import { evaluateKeepRules } from './keep-rules.ts';
import { migrateReviewContract } from './migration.ts';
import { FeedTabCountsSchema } from './schema.ts';
import type { FeedTab } from './schema.ts';
import { withEffectiveEngagement } from '../workspace/effective-engagement.ts';

/** Definition/data-bound work shared by configurations of one account. */
export function prepareFeedCounts(input: WorkspaceV2, accountKey?: string) {
  const workspace = migrateReviewContract(input);
  const checks = currentChecks(workspace);
  // Count membership needs event state, not another assessment projection.
  const states = deriveState({
    ...workspace,
    assessments: [],
    submissions: [],
  });
  const complete = workspace.imports.filter(
    (value) => value.status === 'complete',
  );
  const contexts = new Map(
    (workspace.instagramContext ?? []).map((record) => [record.itemId, record]),
  );
  const items = workspace.items
    .map((item) => withEffectiveEngagement(item, contexts.get(item.id)))
    .filter(
      (item) =>
        (!accountKey || item.account.key === accountKey) &&
        (!workspace.imports.length ||
          complete.some(
            (record) =>
              record.platform === item.platform &&
              record.accounts.some(
                (account) => account.key === item.account.key,
              ) &&
              record.archives.includes(item.provenance.archive),
          )),
    );
  const thresholds = new Map(
    [...new Set(items.map((item) => item.account.key))].map((key) => [
      key,
      popularityThreshold(items, key),
    ]),
  );
  const order = [...items]
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    )
    .map((item) => item.id);
  return { checks, states, items, thresholds, order };
}

export function feedCounts(
  input: WorkspaceV2,
  accountKey?: string,
  systemTimeZone = 'UTC',
  prepared = prepareFeedCounts(input, accountKey),
) {
  const workspace = migrateReviewContract(input);
  const criteria = workspace.settings.criteria!;
  const rules = workspace.settings.keepRules ?? [];
  const hasRules = rules.some((rule) => rule.enabled);
  const { checks, states, items, thresholds } = prepared;
  const tabs = FeedTabCountsSchema.parse({
    suggested: 0,
    held: 0,
    kept: 0,
    unclear: 0,
    marked: 0,
    all: items.length,
  });
  const unchecked: Record<string, number> = Object.fromEntries(
    criteria.selected.map((id) => [id, 0]),
  );
  const membership = new Map<string, FeedTab>();
  const baseMembership = new Map<string, FeedTab>();
  const holding = new Map<string, string[]>();
  const { timeZone } = resolveTimeZone(
    null,
    workspace.settings.timeZone,
    systemTimeZone,
  );
  for (const item of items) {
    const current = checks.get(item.id) ?? [];
    for (const criterion of criteria.selected)
      if (!current.some((check) => check.criterion === criterion))
        unchecked[criterion] = (unchecked[criterion] ?? 0) + 1;
    const hit = current.some(
      (check) =>
        criteria.selected.includes(check.criterion) &&
        check.criterion !== 'harmless' &&
        check.criterion !== 'unclear' &&
        check.status === 'hit' &&
        check.assessment!.risk >= criteria.level,
    );
    const held =
      hit && hasRules
        ? evaluateKeepRules(
            item,
            rules,
            timeZone,
            thresholds.get(item.account.key) ?? null,
          )
        : [];
    holding.set(item.id, held);
    const decision = states.get(item.id)!.decision;
    baseMembership.set(
      item.id,
      hit
        ? held.length
          ? 'held'
          : 'suggested'
        : current.some(
              (check) =>
                check.status === 'unclear' ||
                check.assessment?.category === 'unclear',
            )
          ? 'unclear'
          : 'all',
    );
    const tab: FeedTab =
      decision === 'delete'
        ? 'marked'
        : decision === 'keep'
          ? 'kept'
          : decision === 'later'
            ? 'unclear'
            : hit
              ? held.length
                ? 'held'
                : 'suggested'
              : current.some(
                    (check) =>
                      check.status === 'unclear' ||
                      check.assessment?.category === 'unclear',
                  )
                ? 'unclear'
                : 'all';
    membership.set(item.id, tab);
    if (tab !== 'all') tabs[tab]++;
  }
  return {
    tabs,
    unchecked,
    membership,
    baseMembership,
    holding,
    popularThreshold: accountKey ? (thresholds.get(accountKey) ?? null) : null,
  };
}
