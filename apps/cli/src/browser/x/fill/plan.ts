import { createHash } from 'node:crypto';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import type { Original } from '@socialprune/core';
import { CliError } from '../../../cli/errors.ts';
import { finalNotice } from './final-notice.ts';
import type { FinalNoticeCounts } from './final-notice.ts';
export const FILL_WARNING = {
  en: "X's rules do not allow this kind of automation. X can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. This run only reads: it opens posts in your signed-in X window and keeps what X shows. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.",
  de: 'Die Regeln von X erlauben diese Art von Automatisierung nicht. X kann dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Dieser Lauf liest nur: Er öffnet Beiträge in deinem angemeldeten X-Fenster und speichert, was X anzeigt. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.',
};
export type FillReason = 'unseen' | 'long-text' | 'media';
export interface FillRow {
  id: string;
  reasons: FillReason[];
  anonymousAt: string | null;
  reference: string;
  original: Original;
}
export interface FillPlan {
  accountKey: string;
  handle: string;
  timeZone: string;
  hash: string;
  rows: FillRow[];
  canary: boolean;
  bodyShapes: Record<string, string[]>;
  finalNotices: FinalNoticeCounts;
}
export function reasons(value: Original, include = false): FillReason[] {
  if (!value.anonymous || value.anonymous.status === 'failed') return [];
  return [
    ...(['not-found', 'tombstone'].includes(value.anonymous.status) &&
    (include ||
      value.anonymous.status !== 'tombstone' ||
      finalNotice(value.raw) === null)
      ? ['unseen' as const]
      : []),
    ...(value.textCompleteness === 'truncated' ? ['long-text' as const] : []),
    ...(value.media.some(
      (media) =>
        media.kind !== 'photo' &&
        ['hls-only', 'no-variant', 'not-stored'].includes(media.status) &&
        media.url === null,
    )
      ? ['media' as const]
      : []),
  ];
}
export async function planFill(
  store: WorkspaceStore,
  accountKey: string,
  include: ReadonlySet<string> = new Set(),
): Promise<FillPlan> {
  return store.read(async (tx) => {
    const meta = await tx.meta.get(),
      references = new Map<string, string>();
    let handle: string | null = null;
    for await (const { item } of tx.items.iterate())
      if (item.platform === 'x' && item.account.key === accountKey) {
        handle = item.account.handle;
        for (const id of [item.reference.replyToId, item.reference.quotedId])
          if (id)
            references.set(
              id,
              `${item.createdAt}\t${item.text.split(/[\r\n]/, 1)[0] ?? ''}`,
            );
      }
    let accountFound = false;
    for await (const { item } of tx.items.iterate())
      if (item.platform === 'x' && item.account.key === accountKey)
        accountFound = true;
    if (!accountFound) throw new CliError('ACCOUNT_REQUIRED');
    handle ??= '';
    const originals = new Map<string, Original>();
    for await (const original of tx.originals.iterate())
      originals.set(original.id, original);
    for (const id of [...references.keys()]) {
      let parent = originals.get(id)?.parentId ?? null;
      const seen = new Set<string>();
      for (let i = 0; parent && i < 20 && !seen.has(parent); i++) {
        seen.add(parent);
        references.set(parent, `above ${id}`);
        parent = originals.get(parent)?.parentId ?? null;
      }
      const quoted = originals.get(id)?.quotedId;
      if (quoted) references.set(quoted, `quote of ${id}`);
    }
    const own = new Set<string>();
    for await (const { item } of tx.items.iterate())
      if (item.platform === 'x' && item.account.key === accountKey)
        own.add(item.id.slice(2));
    const rows: FillRow[] = [];
    const finalNotices: FinalNoticeCounts = {
      deleted: 0,
      suspended: 0,
      accountGone: 0,
    };
    for (const [id, reference] of references) {
      if (own.has(id)) continue;
      const original = originals.get(id);
      if (!original) continue;
      if (original.signedIn && !include.has(id)) continue;
      const why = reasons(original, include.has(id));
      if (!why.length) {
        const notice =
          original.anonymous?.status === 'tombstone'
            ? finalNotice(original.raw)
            : null;
        if (notice !== null && !include.has(id)) finalNotices[notice]++;
        continue;
      }
      rows.push({
        id,
        reasons: why,
        anonymousAt: original.anonymous?.at ?? null,
        reference,
        original,
      });
    }
    rows.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
    const hashed = [...rows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, reasons, anonymousAt }) => ({ anonymousAt, id, reasons }));
    const hash = createHash('sha256')
      .update(JSON.stringify(hashed))
      .digest('hex');
    let accepted:
      { startedAt: string; bodyShapes: Record<string, string[]> } | undefined;
    let invalidated = false;
    const ordered = [];
    for await (const run of tx.browserRuns.iterate()) ordered.push(run);
    ordered.sort(
      (a, b) =>
        a.startedAt.localeCompare(b.startedAt) ||
        a.runId.localeCompare(b.runId),
    );
    for (const run of ordered)
      if (run.accountKey === accountKey && run.mode === 'fill') {
        if (run.endReason === 'shape-changed') {
          invalidated = true;
          accepted = undefined;
        }
        if (run.canaryAcceptedAt) {
          accepted = run;
          invalidated = false;
        }
      }
    return {
      accountKey,
      handle,
      timeZone:
        meta.settings.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      rows,
      hash,
      canary: !accepted || invalidated,
      bodyShapes: accepted?.bodyShapes ?? {},
      finalNotices,
    };
  });
}
export function fillSummary(plan: FillPlan, lang: 'en' | 'de' = 'en') {
  const counts = { unseen: 0, 'long-text': 0, media: 0 };
  for (const row of plan.rows)
    for (const reason of row.reasons) counts[reason]++;
  return {
    dryRun: true,
    planned: plan.rows.length,
    reasons: counts,
    finalNotices: plan.finalNotices,
    unseenOnly: plan.rows.filter(
      (row) => row.reasons.length === 1 && row.reasons[0] === 'unseen',
    ).length,
    planHash: plan.hash,
    canary: plan.canary,
    pageOpens: plan.rows.length,
    estimateMs:
      Math.max(0, plan.rows.length - 1) * 30000 +
      Math.floor(Math.max(0, plan.rows.length - 1) / 20) * 900000,
    mediaUpperBoundBytes: plan.rows.reduce(
      (sum, row) =>
        sum +
        row.original.media.reduce(
          (n, media) =>
            n +
            (media.durationMs && media.bitrateLabel
              ? Math.ceil((media.durationMs * media.bitrateLabel) / 8000)
              : 0),
          0,
        ),
      0,
    ),
    unknownMediaMaxBytes: 1024 ** 3,
    warning: FILL_WARNING[lang],
  };
}
export function fillList(plan: FillPlan): string {
  return (
    plan.rows
      .map(
        (row) =>
          `${row.id}\t${row.reasons.join(',')}\t${row.reference}\t${row.original.anonymous?.status ?? 'none'}`,
      )
      .join('\n') + '\n'
  );
}
