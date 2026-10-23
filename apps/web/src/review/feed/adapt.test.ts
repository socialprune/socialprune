import { expect, test } from 'vitest';
import { adaptCard, adaptPreview, ruleLabel } from './adapt.ts';
import { catalogs } from '../../i18n/index.ts';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';
import type {
  FeedCard,
  WorkspaceSummary,
  BulkPreview,
} from '@socialprune/core/workspace/protocol';
import type { useT } from '../../i18n/index.ts';

const t = ((id: string, values?: Record<string, unknown>) =>
  `${id} ${JSON.stringify(values ?? {})}`) as ReturnType<typeof useT>;
const workspace = contractWorkspace();
test.each(['en', 'de'] as const)(
  'hold labels carry their count inside the sentence in %s',
  (locale) => {
    const translate = ((
      id: keyof typeof catalogs.en,
      values?: Record<string, unknown>,
    ) =>
      catalogs[locale][id].replace(
        '{count, number}',
        String(values?.['count']),
      )) as unknown as Parameters<typeof ruleLabel>[1];
    const text = ruleLabel(
      {
        id: 'likes-rule',
        kind: 'likes-at-least',
        count: 10,
        alsoWhenUnknown: false,
        enabled: true,
      },
      translate,
    );
    expect(text).toBe(
      locale === 'en'
        ? 'Never delete with 10 likes or more'
        : 'Nie löschen mit mindestens 10 Gefällt mir',
    );
    expect(text).not.toContain(': 10');
  },
);
const summary = {
  accounts: [workspace.items[0]!.account],
  criteria: { selected: ['political'], custom: [], nextCustom: 1, level: 0 },
  keepRules: [
    {
      id: 'ten',
      kind: 'likes-at-least',
      count: 10,
      alsoWhenUnknown: false,
      enabled: true,
    },
  ],
} as unknown as WorkspaceSummary;
test('card maps all source reasons and rule IDs without recalculating service eligibility', () => {
  const item = {
    ...workspace.items[0]!,
    text: 'Full text '.repeat(80),
    engagement: { likes: 14, reposts: null },
  };
  const card = {
    item,
    suggestions: [
      {
        assessmentId: 'generated',
        category: 'political',
        risk: 2,
        source: { kind: 'fixture', name: 'Example', version: '1' },
        reason: 'An invented reason',
        evidence: 'Full text',
      },
    ],
    holdingRules: ['ten'],
    decision: 'keep',
    outcome: 'unknown',
    decisionEvent: null,
    plan: null,
  } as unknown as FeedCard;
  const view = adaptCard(card, summary, t, 3);
  expect(view.text).toBe(item.text);
  expect(view.suggestions[0]).toMatchObject({
    reason: 'An invented reason',
    source: { kind: 'example' },
    evidence: 'Full text',
  });
  expect(view.heldBy[0]?.id).toBe('ten');
  expect(view.decision).toBe('keep');
});
test('preview counts and all enabled rule snapshots come from the frozen service plan', () => {
  const preview = {
    willChange: 3,
    sample: [],
    plan: {
      criteria: [{ id: 'political', hash: 'generated' }],
      level: 1,
      keepRules: summary.keepRules,
      counts: { held: 2, kept: 1, unclear: 4 },
      sources: [{ kind: 'agent', name: 'Generated reader', count: 3 }],
    },
  } as unknown as BulkPreview;
  const view = adaptPreview(
    preview,
    summary,
    'instagram:generated',
    t,
    'changed',
  );
  expect(view).toMatchObject({
    platform: 'instagram',
    count: 3,
    held: 2,
    kept: 1,
    unclear: 4,
    state: 'changed',
  });
  expect(view.rules).toHaveLength(1);
});
