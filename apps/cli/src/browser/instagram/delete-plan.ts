import { createHash } from 'node:crypto';
import type { DecisionEvent, InstagramContext, Item } from '@socialprune/core';
import { validateInstagramContextItem } from '@socialprune/core';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import type { PlannedEntry } from '../../workspace/browser-journal.ts';
import { CliError } from '../../cli/errors.ts';
import { dateInZone } from '../pace.ts';
import { instagramHandle, normalize, ownerName } from './plan.ts';

export type InstagramDeleteRow = PlannedEntry & {
  action: 'delete-comment';
  context: InstagramContext & { confirmedBy: 'post' };
};
export interface InstagramDeletePlan {
  accountKey: string;
  handle: string;
  timeZone: string;
  day: string;
  rows: InstagramDeleteRow[];
  hash: string;
  canary: boolean;
  manual: {
    noContext: number;
    list: number;
    noOwner: number;
    identity: number;
    unresolved: number;
  };
}
export const INSTAGRAM_DELETE_WARNING = {
  en: "Instagram's rules do not allow this kind of automation. Instagram can lock or suspend your account, even at this pace. This run deletes only your marked, uniquely identified comments, through your signed-in browser. SocialPrune does not hide program control. A comment on a reel shared to Facebook can be removed there too. Use it only for your own account and only if you accept this.",
  de: 'Die Regeln von Instagram erlauben diese Art von Automatisierung nicht. Instagram kann dein Konto dafür sperren oder einschränken, auch bei diesem Tempo. Dieser Lauf löscht nur deine markierten, eindeutig identifizierten Kommentare in deinem angemeldeten Browser. SocialPrune verbirgt die Programmsteuerung nicht. Ein Kommentar zu einem auf Facebook geteilten Reel kann auch dort entfernt werden. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.',
};
export const INSTAGRAM_DELETION_PROTOCOL = 'ig-del-v1-a-1';
export async function planInstagramDeletion(
  store: WorkspaceStore,
  accountKey: string,
  now = new Date(),
): Promise<InstagramDeletePlan> {
  return store.read(async (tx) => {
    const meta = await tx.meta.get();
    const timeZone =
      meta.settings.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    let handle = '',
      found = false;
    for await (const imported of tx.imports.iterate()) {
      const account =
        imported.platform === 'instagram' && imported.status === 'complete'
          ? imported.accounts.find((a) => a.key === accountKey)
          : undefined;
      if (account) {
        found = true;
        handle = account.handle ?? '';
      }
    }
    if (!found) throw new CliError('ACCOUNT_REQUIRED');
    if (handle) instagramHandle(handle);
    const decisions = new Map<string, DecisionEvent>();
    for await (const event of tx.decisionEvents.iterate())
      decisions.set(event.itemId, event);
    const attempts = [];
    for await (const attempt of tx.browserAttempts.iterate())
      attempts.push(attempt);
    let acceptedAt = 0,
      invalidatedAt = 0;
    const deletionRuns = new Set<string>();
    for await (const run of tx.browserRuns.iterate())
      if (
        run.accountKey === accountKey &&
        run.platform === 'instagram' &&
        run.mode === 'delete'
      ) {
        deletionRuns.add(run.runId);
        if (
          run.endReason === 'canary' &&
          run.canaryAcceptedAt &&
          run.bodyShapes['deletion-protocol']?.join(',') ===
            INSTAGRAM_DELETION_PROTOCOL
        )
          acceptedAt = Math.max(acceptedAt, Date.parse(run.canaryAcceptedAt));
        if (
          run.bodyShapes['stop']?.some((code) =>
            ['INSTAGRAM_SHAPE_CHANGED', 'SHAPE_CHANGED'].includes(code),
          )
        )
          invalidatedAt = Math.max(
            invalidatedAt,
            Date.parse(run.endedAt ?? run.startedAt),
          );
      }
    for (const attempt of attempts)
      if (
        deletionRuns.has(attempt.runId) &&
        attempt.action === 'delete-comment' &&
        (attempt.state === 'ambiguous' ||
          (attempt.state === 'sending' &&
            !attempts.some(
              (settlement) => settlement.settles === attempt.attemptId,
            )))
      )
        invalidatedAt = Math.max(invalidatedAt, Date.parse(attempt.at));
    const canary = acceptedAt === 0 || invalidatedAt >= acceptedAt;
    const manual = {
      noContext: 0,
      list: 0,
      noOwner: 0,
      identity: 0,
      unresolved: 0,
    };
    const rows: InstagramDeleteRow[] = [],
      items: Item[] = [];
    for await (const stored of tx.items.iterate())
      if (
        stored.item.platform === 'instagram' &&
        stored.item.kind === 'comment' &&
        stored.item.account.key === accountKey &&
        (await tx.imports.get(stored.importId))?.status === 'complete'
      )
        items.push(stored.item);
    for (const item of items) {
      const state = await tx.state.get(item.id),
        decision = decisions.get(item.id);
      if (
        state?.decision !== 'delete' ||
        state.outcome !== 'unknown' ||
        decision?.value !== 'delete' ||
        decision.source.kind !== 'human'
      )
        continue;
      const context = await tx.instagramContext.get(item.id);
      if (!context) {
        manual.noContext++;
        continue;
      }
      if (context.confirmedBy !== 'post') {
        manual.list++;
        continue;
      }
      if (context.ownerCheck !== 'matched-export') {
        manual.noOwner++;
        continue;
      }
      try {
        validateInstagramContextItem(context, item);
      } catch {
        manual.identity++;
        continue;
      }
      if (
        !normalize(item.text) ||
        context.post.ownerCount !== 1 ||
        items.some(
          (other) =>
            other.id !== item.id &&
            normalize(other.text) === normalize(item.text) &&
            (!other.reference.ownerHandle ||
              ownerName(other.reference.ownerHandle) ===
                ownerName(item.reference.ownerHandle ?? '')) &&
            Math.abs(
              Date.parse(other.createdAt) - Date.parse(item.createdAt),
            ) <= 120000,
        )
      ) {
        manual.identity++;
        continue;
      }
      const own = attempts.filter(
        (a) => a.itemId === item.id && a.action !== 'confirm-comment',
      );
      if (
        own.some(
          (a) =>
            ['sending', 'ambiguous'].includes(a.state) &&
            !own.some((b) => b.settles === a.attemptId),
        )
      ) {
        manual.unresolved++;
        continue;
      }
      rows.push({ item, decision, context, action: 'delete-comment' });
    }
    rows.sort(
      (a, b) =>
        a.item.createdAt.localeCompare(b.item.createdAt) ||
        a.item.id.localeCompare(b.item.id),
    );
    const day = dateInZone(now, timeZone);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          accountKey,
          protocol: INSTAGRAM_DELETION_PROTOCOL,
          day,
          timeZone,
          canary,
          rows: rows.map(({ item, decision, context }) => ({
            item,
            decision: decision.eventId,
            context,
          })),
        }),
      )
      .digest('hex');
    return { accountKey, handle, timeZone, day, rows, hash, canary, manual };
  });
}
export function instagramDeleteSummary(
  plan: InstagramDeletePlan,
  lang: 'en' | 'de',
) {
  return {
    dryRun: true,
    planned: plan.rows.length,
    manual: plan.manual,
    canary: plan.canary,
    canaryItemId: plan.canary ? (plan.rows[0]?.item.id ?? null) : null,
    planHash: plan.hash,
    timeZone: plan.timeZone,
    secondsPerStep: 30,
    attemptsPerBatch: 10,
    batchPauseSeconds: 900,
    attemptsPerDay: 50,
    warning: INSTAGRAM_DELETE_WARNING[lang],
  };
}
