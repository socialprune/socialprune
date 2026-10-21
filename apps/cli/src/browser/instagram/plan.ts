import { createHash } from 'node:crypto';
import type { Item } from '@socialprune/core';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import { CliError } from '../../cli/errors.ts';
import { plainLines } from '../../cli/output.ts';
import { CONTEXT_WARNING } from './copy.ts';
import { dateInZone } from '../pace.ts';
import { contextPace, contextEstimate, paceSummary } from './pace.ts';
import type { ContextPace } from './pace.ts';

export function normalize(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
export function ownerName(value: string): string {
  return value.replace(/^@/, '').toLowerCase();
}
export function instagramHandle(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = value.replace(/^@/, '');
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(name))
    throw new CliError('INVALID_ARGUMENTS');
  return name;
}
export interface ContextRow {
  item: Item;
  marked: boolean;
}
export interface ContextPlan {
  accountKey: string;
  handle: string;
  timeZone: string;
  rows: ContextRow[];
  hash: string;
  canary: boolean;
  manual: { emptyText: number; noOwner: number; closeTwin: number };
  confirmed: number;
  excluded: { unconfirmed: number; 'not-listed': number; unavailable: number };
  personExcluded: number;
  excludeUnmatched: number;
}
export async function planContext(
  store: WorkspaceStore,
  accountKey: string,
  include: ReadonlySet<string> = new Set(),
  exclude: ReadonlySet<string> = new Set(),
): Promise<ContextPlan> {
  if ([...exclude].some((id) => include.has(id)))
    throw new CliError('INVALID_ARGUMENTS');
  return store.read(async (tx) => {
    const meta = await tx.meta.get();
    let handle: string | null = null,
      found = false;
    for await (const imported of tx.imports.iterate())
      if (imported.platform === 'instagram' && imported.status === 'complete') {
        const account = imported.accounts.find(
          (entry) => entry.key === accountKey,
        );
        if (account) {
          found = true;
          handle = account.handle;
        }
      }
    if (!found) throw new CliError('ACCOUNT_REQUIRED');
    if (handle) instagramHandle(handle);
    const items: Item[] = [];
    for await (const stored of tx.items.iterate())
      if (
        stored.item.platform === 'instagram' &&
        stored.item.kind === 'comment' &&
        stored.item.account.key === accountKey &&
        (await tx.imports.get(stored.importId))?.status === 'complete'
      )
        items.push(stored.item);
    const twins = new Set<string>();
    const groups = new Map<string, Item[]>();
    for (const item of items) {
      const key = JSON.stringify([
        normalize(item.text),
        ownerName(item.reference.ownerHandle ?? ''),
      ]);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      for (let index = 1; index < group.length; index++)
        if (
          Date.parse(group[index]!.createdAt) -
            Date.parse(group[index - 1]!.createdAt) <=
          120_000
        ) {
          twins.add(group[index]!.id);
          twins.add(group[index - 1]!.id);
        }
    }
    const last = new Map<string, string>();
    const runs = [];
    for await (const run of tx.browserRuns.iterate())
      if (
        run.platform === 'instagram' &&
        run.accountKey === accountKey &&
        run.mode === 'context'
      )
        runs.push(run);
    const runIds = new Set(runs.map((run) => run.runId));
    for await (const attempt of tx.browserAttempts.iterate())
      if (runIds.has(attempt.runId) && attempt.itemId && attempt.settles)
        last.set(attempt.itemId, attempt.state);
    const manual = { emptyText: 0, noOwner: 0, closeTwin: 0 },
      excluded = { unconfirmed: 0, 'not-listed': 0, unavailable: 0 };
    let confirmed = 0;
    let personExcluded = 0;
    const unmatched = new Set(exclude);
    const personExcludes = (itemId: string) => {
      if (!exclude.has(itemId)) return false;
      personExcluded++;
      unmatched.delete(itemId);
      return true;
    };
    const rows: ContextRow[] = [];
    const humanDecisions = new Map<string, boolean>();
    for await (const event of tx.decisionEvents.iterate())
      humanDecisions.set(
        event.itemId,
        event.value === 'delete' && event.source.kind === 'human',
      );
    for (const item of items) {
      if (!normalize(item.text)) {
        if (!personExcludes(item.id)) manual.emptyText++;
        continue;
      }
      if (!ownerName(item.reference.ownerHandle ?? '')) {
        if (!personExcludes(item.id)) manual.noOwner++;
        continue;
      }
      if (twins.has(item.id)) {
        if (!personExcludes(item.id)) manual.closeTwin++;
        continue;
      }
      if (await tx.instagramContext.get(item.id)) {
        confirmed++;
        continue;
      }
      const state = last.get(item.id);
      if (
        (state === 'unconfirmed' ||
          state === 'not-listed' ||
          state === 'unavailable') &&
        !include.has(item.id)
      ) {
        excluded[state]++;
        continue;
      }
      if (personExcludes(item.id)) continue;
      const current = await tx.state.get(item.id);
      rows.push({
        item,
        marked:
          current?.decision === 'delete' &&
          humanDecisions.get(item.id) === true,
      });
    }
    rows.sort(
      (a, b) =>
        Number(b.marked) - Number(a.marked) ||
        Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt) ||
        a.item.id.localeCompare(b.item.id),
    );
    const selected = rows.map(({ item, marked }) => ({
      itemId: item.id,
      marked,
    }));
    const hash = createHash('sha256')
      .update(
        JSON.stringify(
          exclude.size
            ? { rows: selected, exclude: [...exclude].sort() }
            : selected,
        ),
      )
      .digest('hex');
    runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    let accepted = false;
    for (const run of runs) {
      if (run.endReason === 'shape-changed') accepted = false;
      if (run.canaryAcceptedAt) accepted = true;
    }
    return {
      accountKey,
      handle: handle ?? '',
      timeZone:
        meta.settings.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      rows,
      hash,
      canary: !accepted,
      manual,
      confirmed,
      excluded,
      personExcluded,
      excludeUnmatched: unmatched.size,
    };
  });
}
export function contextSummary(
  plan: ContextPlan,
  lang: 'en' | 'de' = 'en',
  pace: ContextPace = contextPace(undefined, plan.canary),
) {
  return {
    dryRun: true,
    planned: plan.rows.length,
    marked: plan.rows.filter((row) => row.marked).length,
    manual: plan.manual,
    confirmed: plan.confirmed,
    excluded: plan.excluded,
    personExcluded: plan.personExcluded,
    excludeUnmatched: plan.excludeUnmatched,
    canary: plan.canary,
    planHash: plan.hash,
    steps: plan.rows.length,
    days: Math.ceil(plan.rows.length / pace.perDay),
    estimateMs: contextEstimate(plan.rows.length, pace),
    pace: paceSummary(pace),
    timeZone: plan.timeZone,
    warning: CONTEXT_WARNING[lang],
  };
}
export function contextList(plan: ContextPlan): string {
  return (
    plan.rows
      .map(
        ({ item, marked }) =>
          `${item.id}\t${dateInZone(item.createdAt, plan.timeZone)}\t${plainLines(item.text.split(/[\r\n]/, 1)[0]!).trim()}\t${plainLines(item.reference.ownerHandle ?? '')}\t${marked ? 'delete' : 'not-marked'}`,
      )
      .join('\n') + '\n'
  );
}
export function canaryRows(plan: ContextPlan): ContextRow[] {
  const oldest = [...plan.rows].sort(
    (a, b) =>
      Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt) ||
      a.item.id.localeCompare(b.item.id),
  )[0];
  return oldest
    ? [oldest, ...plan.rows.filter((row) => row !== oldest)].slice(0, 15)
    : [];
}
