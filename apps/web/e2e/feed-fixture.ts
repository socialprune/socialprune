import type { WorkspaceV2 } from '@socialprune/core';
import {
  criterionHash,
  migrateReviewContract,
} from '@socialprune/core/criteria';
import { reviewFixture } from './review-fixture.ts';
import { waitForApp } from './helpers.ts';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const liveExpected = {
  account: 'x:feed',
  instagram: 'instagram:feed',
  suggested: ['x:feed-1', 'x:feed-2', 'x:feed-3'],
  held: ['x:feed-4'],
  kept: ['x:feed-5'],
  unclear: ['x:feed-6', 'x:feed-8'],
  marked: ['x:feed-7'],
};
export function liveFeedFixture(count = 8): WorkspaceV2 {
  const old = reviewFixture('personal', false, Math.max(8, count));
  old.settings.categories = ['political', 'unclear'];
  old.items.forEach((item, n) => {
    item.id = `x:feed-${n + 1}`;
    item.account = { key: liveExpected.account, handle: 'invented_feed' };
    item.text = `Invented political post ${n + 1}. A generated council discussion.`;
    item.kind = 'post';
    item.mediaCount = n === 1 ? 2 : 0;
    item.createdAt = new Date(
      Date.UTC(2024, 0, 31) - n * 86400000,
    ).toISOString();
    item.engagement = { likes: n === 3 ? 14 : 0, reposts: 0 };
  });
  const instagram = {
    ...structuredClone(old.items[0]!),
    id: 'instagram:feed-comment',
    platform: 'instagram' as const,
    account: { key: liveExpected.instagram, handle: 'invented_commenter' },
    kind: 'comment' as const,
    text: 'Invented comment about a park and council.',
    engagement: { likes: null, reposts: null },
    url: null,
  };
  instagram.reference.ownerHandle = 'generated_owner';
  old.items.push(instagram);
  const data = migrateReviewContract(old);
  data.settings.criteria!.selected = ['political'];
  data.settings.criteria!.level = 0;
  data.settings.keepRules = [
    {
      id: 'likes-ten',
      kind: 'likes-at-least',
      count: 10,
      alsoWhenUnknown: false,
      enabled: true,
    },
  ];
  data.settings.review = {
    accountKey: liveExpected.account,
    filter: {},
    search: '',
    sort: [{ by: 'createdAt', direction: 'desc' }],
    feed: { tab: 'suggested', anchors: {} },
  };
  data.assessments = data.items.map((item, index) => ({
    assessmentId: `generated-feed-${index}`,
    itemId: item.id,
    submissionId: 'generated-feed-labels',
    source: { kind: 'agent', name: 'Synthetic reader', version: '1' },
    category: index === 5 ? 'unclear' : 'political',
    risk: index === 5 ? 0 : 2,
    reason:
      index === 5
        ? 'The generated context is unclear.'
        : 'The generated post discusses council policy.',
    evidence: index === 5 ? null : 'generated',
    confidence: null,
    createdAt: '2026-10-01T12:00:00.000Z',
  }));
  data.submissions = [
    {
      submissionId: 'generated-feed-labels',
      contentHash: `sha256:${'b'.repeat(64)}`,
      source: { kind: 'agent', name: 'Synthetic reader', version: '1' },
      receivedAt: '2026-10-01T12:00:00.000Z',
      labelCount: data.assessments.length,
      criteria: ['political', 'unclear'].map((id) => ({
        id,
        hash: criterionHash(id, data.settings),
      })),
    },
  ];
  data.decisionEvents = (
    count === 8
      ? ([
          [4, 'keep'],
          [6, 'delete'],
          [7, 'later'],
        ] as const)
      : []
  ).map(([index, value], n) => ({
    eventId: `generated-decision-${n}`,
    seq: n + 1,
    itemId: data.items[index]!.id,
    value,
    previous: 'undecided',
    decidedAt: '2026-10-10T12:00:00.000Z',
    source: { kind: 'human', via: 'web-review' },
    action: {
      id: `generated-action-${n}`,
      kind: 'single',
      size: 1,
      reverts: null,
    },
  }));
  data.counts = {
    ...data.counts,
    items: data.items.length,
    assessments: data.assessments.length,
    submissions: 1,
    decisionEvents: data.decisionEvents.length,
  };
  return data;
}
export async function restoreLiveFeed(page: Page, data = liveFeedFixture()) {
  await waitForApp(page);
  const reply = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-feed.json'),
      }),
    JSON.stringify(data),
  );
  expect(reply.type).toBe('opened');
  await page.goto('/socialprune/#/review');
  await expect(page.getByRole('feed')).toBeVisible();
  await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
  return data;
}
