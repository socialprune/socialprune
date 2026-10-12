import { createHash } from 'node:crypto';
import type { DecisionEvent } from '@socialprune/core';
import type { SQLiteStore } from '../workspace/sqlite-store.ts';
import type { PlannedEntry } from '../workspace/browser-journal.ts';
import { plainLines } from '../cli/output.ts';
import { CliError } from '../cli/errors.ts';
import { dateInZone, estimate } from './pace.ts';
import { BROWSER_WARNING } from './copy.ts';

export interface DeletePlan {
  accountKey: string;
  handle: string;
  timeZone: string;
  rows: PlannedEntry[];
  hash: string;
  originalsPending: number;
  originalsFillable: number;
}
export function displayRow(row: PlannedEntry, timeZone: string) {
  return {
    itemId: row.item.id,
    eventId: row.decision.eventId,
    date: dateInZone(row.item.createdAt, timeZone),
    kind: row.item.kind,
    action: row.action,
    firstLine: plainLines(row.item.text.split(/[\r\n]/, 1)[0]!).trim(),
    decisionTime: row.decision.decidedAt,
    via: row.decision.source.via,
    origin:
      row.decision.action.kind === 'bulk' || row.decision.action.size > 1
        ? 'bulk'
        : 'single',
  };
}
export async function planDeletion(
  store: SQLiteStore,
  accountKey: string,
  include: ReadonlySet<string> = new Set(),
): Promise<DeletePlan> {
  const journal = await store.browserJournal();
  return store.read(async (tx) => {
    const meta = await tx.meta.get();
    const timeZone =
      meta.settings.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    const decisions = new Map<string, DecisionEvent>();
    for await (const event of tx.decisionEvents.iterate())
      decisions.set(event.itemId, event);
    const rows: PlannedEntry[] = [];
    let handle: string | null = null;
    for await (const imported of tx.imports.iterate())
      if (imported.platform === 'x') {
        const account = imported.accounts.find((a) => a.key === accountKey);
        if (account) handle = account.handle;
      }
    if (!handle || !/^[A-Za-z0-9_]{1,50}$/.test(handle))
      throw new CliError('ACCOUNT_REQUIRED');
    for await (const stored of tx.items.iterate()) {
      const item = stored.item;
      if (
        item.platform !== 'x' ||
        item.account.key !== accountKey ||
        !['post', 'reply', 'quote', 'repost'].includes(item.kind)
      )
        continue;
      if ((await tx.imports.get(stored.importId))?.status !== 'complete')
        continue;
      const state = await tx.state.get(item.id);
      const decision = decisions.get(item.id);
      if (
        state?.outcome !== 'unknown' ||
        state.decision !== 'delete' ||
        decision?.value !== 'delete' ||
        decision.source.kind !== 'human'
      )
        continue;
      const attempts = journal.attempts.filter((a) => a.itemId === item.id);
      // An include file never authorizes resending an unresolved request.
      const unresolved = attempts.some(
        (a) =>
          ['sending', 'ambiguous'].includes(a.state) &&
          !attempts.some((other) => other.settles === a.attemptId),
      );
      const last = attempts.at(-1);
      if (
        unresolved ||
        (last &&
          ['not-found', 'failed'].includes(last.state) &&
          !include.has(item.id))
      )
        continue;
      if (!/^x:\d+$/.test(item.id)) throw new CliError('PLATFORM_CHECK');
      rows.push({
        item,
        decision,
        action: item.kind === 'repost' ? 'undo-repost' : 'delete-post',
      });
    }
    rows.sort((a, b) => a.item.id.localeCompare(b.item.id));
    const hash = createHash('sha256')
      .update(JSON.stringify(rows.map((row) => displayRow(row, timeZone))))
      .digest('hex');
    let originalsPending = 0,
      originalsFillable = 0;
    for (const row of rows)
      if (row.item.kind === 'reply' || row.item.kind === 'quote') {
        const id =
          row.item.kind === 'reply'
            ? row.item.reference.replyToId
            : row.item.reference.quotedId;
        const original = id ? await tx.originals.get(id) : undefined;
        if (!original?.anonymous || original.anonymous.status === 'failed')
          originalsPending++;
        else if (
          !original.signedIn &&
          (original.anonymous.status !== 'fetched' ||
            original.textCompleteness === 'truncated' ||
            original.media.some(
              (media) =>
                media.kind !== 'photo' &&
                ['hls-only', 'no-variant', 'not-stored'].includes(media.status),
            ))
        )
          originalsFillable++;
      }
    return {
      rows,
      hash,
      accountKey,
      handle,
      timeZone,
      originalsPending,
      originalsFillable,
    };
  });
}
export function planSummary(plan: DeletePlan, lang: 'en' | 'de' = 'en') {
  return {
    dryRun: true,
    planned: plan.rows.length,
    bulk: plan.rows.filter(
      (row) => displayRow(row, plan.timeZone).origin === 'bulk',
    ).length,
    planHash: plan.hash,
    estimateMs: estimate(plan.rows.length),
    timeZone: plan.timeZone,
    originalsPending: plan.originalsPending,
    originalsFillable: plan.originalsFillable,
    warning: BROWSER_WARNING[lang],
  };
}
export function planText(plan: DeletePlan, lang: 'en' | 'de' = 'en'): string {
  const summary = planSummary(plan, lang);
  return (
    `${summary.planned} planned entries; ${summary.bulk} from bulk actions.\nPlan: ${summary.planHash}\nEstimated active time: ${Math.ceil(summary.estimateMs / 60_000)} minutes; daily caps can spread it across days.\n${summary.warning}\n` +
    `${plan.originalsPending} unsettled originals block a run without --without-originals. ${plan.originalsFillable} stored originals still have gaps; originals fill x can show its plan.\n` +
    plan.rows
      .map((row) => {
        const value = displayRow(row, plan.timeZone);
        return `${value.itemId}\t${value.date}\t${value.kind}\t${value.action}\t${value.firstLine}\t${value.decisionTime}\t${value.via}\t${value.origin}`;
      })
      .join('\n') +
    '\n'
  );
}
