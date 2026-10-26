import { expect, test } from 'vitest';
import { effectiveEngagement } from './effective-engagement.ts';
import type { Item, InstagramContext } from '../model/index.ts';
import {
  instagramContractItem,
  instagramContractRecord,
} from './store-contract.ts';
import { popularityThreshold, popularIds } from './popular.ts';
import { evaluateKeepRules } from '../criteria/keep-rules.ts';
import { CompactFeed } from './feed-compact.ts';
import { createWorkspace } from './store.ts';

test('effective likes prefer export, otherwise exact post-confirmed comment likes; unknown stays null', () => {
  const item = {
    id: 'instagram:generated',
    platform: 'instagram',
    kind: 'comment',
    engagement: { likes: null, reposts: null },
  } as Item;
  const context = {
    itemId: item.id,
    confirmedBy: 'post',
    likes: { count: 12, source: 'answer' },
  } as InstagramContext;
  expect(effectiveEngagement(item, context)).toEqual({
    likes: 12,
    reposts: null,
  });
  expect(
    effectiveEngagement(
      { ...item, engagement: { likes: 4, reposts: null } },
      context,
    ).likes,
  ).toBe(4);
  expect(
    effectiveEngagement(item, { ...context, itemId: 'instagram:other' }).likes,
  ).toBeNull();
  expect(
    effectiveEngagement(item, {
      ...context,
      confirmedBy: 'list',
    } as InstagramContext).likes,
  ).toBeNull();
  expect(effectiveEngagement(item).likes).toBeNull();
});

test('Instagram known effective likes use tenth ties and floor while unknown and repost rules remain distinct', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    ...instagramContractItem(),
    id: `instagram:generated-${index}`,
    engagement: {
      likes: index < 2 ? 12 : index === 2 ? 11 : index === 19 ? null : 1,
      reposts: null,
    },
  }));
  const account = items[0]!.account.key;
  expect(popularityThreshold(items, account)).toBe(12);
  expect([...popularIds(items, account)]).toEqual(
    items.slice(0, 2).map((item) => item.id),
  );
  const rules = [
    {
      id: 'likes',
      enabled: true,
      kind: 'likes-at-least' as const,
      count: 10,
      alsoWhenUnknown: false,
    },
    {
      id: 'reposts',
      enabled: true,
      kind: 'reposts-at-least' as const,
      count: 1,
      alsoWhenUnknown: true,
    },
  ];
  expect(evaluateKeepRules(items[0]!, rules, 'UTC', 12)).toEqual(['likes']);
  expect(evaluateKeepRules(items[19]!, rules, 'UTC', 12)).toEqual([]);
  expect(
    popularityThreshold(
      [{ ...items[0]!, engagement: { likes: 2, reposts: null } }],
      account,
    ),
  ).toBe(3);
  const workspace = createWorkspace();
  workspace.items = items;
  workspace.instagramContext = [
    {
      ...instagramContractRecord(items[19]),
      likes: { count: 12, source: 'answer' },
    },
  ];
  expect(
    new CompactFeed(workspace).project(workspace.settings, account)
      .popularThreshold,
  ).toBe(12);
});
