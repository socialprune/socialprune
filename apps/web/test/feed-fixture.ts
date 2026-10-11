import type { Assessment, Item } from '@socialprune/core';
import { personFixture } from './person-fixture.ts';

export const feedExpected = {
  account: 'synthetic-review',
  threshold: 8,
  order: [
    'x:feed-0017',
    'x:feed-0016',
    'x:feed-0019',
    'x:feed-0018',
    'x:feed-0003',
    'x:feed-0001',
  ],
  total: 6,
  popular: ['x:feed-0019', 'x:feed-0018'],
  likes: 13,
  previewPopular: 2,
  newest: 'x:feed-0019',
  quote: 'invented helpful words',
} as const;

export function feedFixture() {
  const data = personFixture();
  const base = data.items[0]!;
  const item = (index: number, likes: number | null): Item => ({
    ...structuredClone(base),
    id: `x:feed-${String(index).padStart(4, '0')}`,
    kind: 'post',
    text: `Generated feed ${index}: invented helpful words.`,
    createdAt: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
    engagement: { likes, reposts: 0 },
    url: `https://x.com/i/web/status/${1000 + index}`,
  });
  data.items = Array.from({ length: 20 }, (_, index) =>
    item(index, [3, 5, 8, 13][index - 16] ?? 0),
  );
  const repost = item(20, 9000);
  repost.kind = 'repost';
  repost.reference.repostOfHandle = 'generated_foreign';
  const instagram = structuredClone(personFixture().items[7]!);
  instagram.engagement.likes = 9000;
  data.items.push(repost, instagram);
  const seed = personFixture().assessments[0]!;
  const label = (index: number, risk: number, number: number): Assessment => ({
    ...structuredClone(seed),
    assessmentId: `feed-assessment-${number}`,
    itemId: data.items[index]!.id,
    risk,
    reason: `Generated suggestion for feed ${index}.`,
    evidence: index === 19 ? 'invented helpful words' : null,
  });
  data.assessments = [
    label(1, 2, 1),
    label(3, 2, 3),
    label(16, 3, 16),
    label(17, 3, 17),
    label(18, 2, 18),
    label(19, 2, 19),
    label(2, 3, 20),
    label(2, 1, 21),
    { ...label(0, 2, 22), itemId: instagram.id },
  ];
  data.settings.review = {
    accountKey: feedExpected.account,
    filter: {},
    sort: [
      { by: 'risk', direction: 'desc' },
      { by: 'createdAt', direction: 'desc' },
      { by: 'id', direction: 'asc' },
    ],
    search: '',
  };
  data.counts.items = data.items.length;
  data.counts.assessments = data.assessments.length;
  data.submissions[0]!.labelCount = data.assessments.length;
  data.imports = [];
  return data;
}

export function largeFeedFixture() {
  const data = feedFixture();
  const seed = data.items[0]!,
    suggestion = data.assessments[0]!;
  data.items = Array.from({ length: 100 }, (_, index) => ({
    ...structuredClone(seed),
    id: `x:large-feed-${String(index).padStart(4, '0')}`,
    text: `Generated large feed ${index}.`,
    engagement: { likes: index, reposts: 0 },
  }));
  data.assessments = data.items.map((item, index) => ({
    ...structuredClone(suggestion),
    assessmentId: `large-feed-assessment-${index}`,
    itemId: item.id,
    risk: 2,
    evidence: null,
  }));
  data.counts.items = 100;
  data.counts.assessments = 100;
  data.submissions[0]!.labelCount = 100;
  return data;
}
