import type {
  FeedCard,
  BulkPreview,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import type { KeepRule } from '@socialprune/core/criteria';
import type { FeedCardModel, MarkPreviewModel } from './types.ts';
import type { useT } from '../../i18n/index.ts';
import { categoryMessage } from '../model.ts';

type Translate = ReturnType<typeof useT>;
export function criterionLabel(
  id: string,
  summary: WorkspaceSummary,
  t: Translate,
): string {
  const custom = summary.criteria?.custom.find((entry) => entry.id === id);
  if (custom) return custom.label;
  return Object.hasOwn(categoryMessage, id)
    ? t(categoryMessage[id as keyof typeof categoryMessage])
    : id;
}
export function ruleLabel(
  rule: KeepRule,
  t: Translate,
  threshold: number | null = null,
): string {
  switch (rule.kind) {
    case 'top-liked-tenth':
      return `${t('keepRules.top')} (${t('keepRules.threshold', { count: threshold ?? 3 })})`;
    case 'likes-at-least':
      return t('reviewFeed.ruleLikes', { count: rule.count });
    case 'reposts-at-least':
      return t('reviewFeed.ruleReposts', { count: rule.count });
    case 'created-from':
      return `${t('keepRules.date')}: ${rule.date}`;
  }
}
export function adaptCard(
  card: FeedCard,
  summary: WorkspaceSummary,
  t: Translate,
  threshold: number | null,
): FeedCardModel {
  const { item } = card;
  return {
    id: item.id,
    name: item.account.handle ?? '',
    handle: item.account.handle ?? item.account.key,
    createdAt: item.createdAt,
    text: item.text,
    kind: item.kind,
    mediaCount: item.mediaCount ?? 0,
    likes: item.engagement.likes,
    reposts: item.engagement.reposts,
    replyTo:
      item.kind === 'comment'
        ? (item.reference.ownerHandle ?? t('proto.unknownOwner'))
        : (item.reference.replyToHandle ?? undefined),
    decision: card.decision,
    decidedAt: card.decisionEvent?.decidedAt,
    markedVia: card.plan ? 'final' : 'single',
    deleted: ['deleted-by-user', 'deleted-via-browser'].includes(card.outcome),
    suggestions: card.suggestions.map((assessment) => ({
      id: assessment.assessmentId,
      category: criterionLabel(assessment.category, summary, t),
      level: assessment.risk as 0 | 1 | 2 | 3,
      source: {
        kind:
          assessment.source.kind === 'fixture'
            ? 'example'
            : assessment.source.kind === 'rules'
              ? 'words'
              : assessment.source.kind,
        name: assessment.source.name,
      },
      reason: assessment.reason,
      evidence: assessment.evidence ?? undefined,
      ownCriterion: assessment.category.startsWith('custom-'),
      unclear: assessment.category === 'unclear',
      harmless: assessment.category === 'harmless',
    })),
    heldBy: card.holdingRules.flatMap((id) => {
      const rule = summary.keepRules?.find((rule) => rule.id === id);
      if (!rule) return [];
      const value =
        rule.kind === 'created-from'
          ? item.createdAt.slice(0, 10)
          : t(
              rule.kind === 'reposts-at-least'
                ? 'proto.reposts'
                : 'review.likesValue',
              {
                count:
                  (rule.kind === 'reposts-at-least'
                    ? item.engagement.reposts
                    : item.engagement.likes) ?? -1,
              },
            );
      return [{ id, value, rule: ruleLabel(rule, t, threshold) }];
    }),
  };
}
export function adaptPreview(
  preview: BulkPreview | null,
  summary: WorkspaceSummary,
  accountKey: string,
  t: Translate,
  state: MarkPreviewModel['state'],
): MarkPreviewModel {
  const account = summary.accounts.find(
    (account) => account.key === accountKey,
  );
  const plan = preview?.plan;
  return {
    account: account?.handle ?? accountKey,
    platform: accountKey.startsWith('instagram:') ? 'instagram' : 'x',
    count: preview?.willChange ?? 0,
    criteria: (
      plan?.criteria.map((criterion) =>
        criterionLabel(criterion.id, summary, t),
      ) ?? []
    ).join(', '),
    level: t(
      (['markPreview.every', 'markPreview.low', 'markPreview.medium'] as const)[
        plan?.level ?? 0
      ],
    ),
    held: plan?.counts.held ?? 0,
    kept: plan?.counts.kept ?? 0,
    unclear: plan?.counts.unclear ?? 0,
    sources: (plan?.sources ?? []).map((source) => ({
      name:
        source.kind === 'fixture'
          ? t('review.example')
          : source.kind === 'agent'
            ? t('review.agent', { name: source.name })
            : source.kind === 'model'
              ? t('review.modelSource', { name: source.name })
              : t('reviewFeed.wordLists'),
      count: source.count,
    })),
    sample: (preview?.sample ?? []).map((row) => ({
      id: row.id,
      name: account?.handle ?? '',
      handle: account?.handle ?? '',
      createdAt: row.createdAt,
      text: row.text,
      mediaCount: row.mediaCount ?? 0,
    })),
    state,
    rules: (plan?.keepRules ?? [])
      .filter((rule) => rule.enabled)
      .map((rule) => ruleLabel(rule, t)),
  };
}
