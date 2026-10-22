import { expect, test } from 'vitest';
import {
  HttpReviewRequestSchema,
  WorkspaceRequestSchema,
  WorkspaceReplySchema,
} from './protocol.ts';
import { DesktopRequestSchema } from './desktop-protocol.ts';

export const feedRequests = [
  { type: 'planCounts', requestId: 'counts', accountKey: 'x:generated' },
  {
    type: 'feedWindow',
    requestId: 'feed',
    accountKey: 'x:generated',
    tab: 'suggested',
    offset: 0,
    limit: 50,
  },
  {
    type: 'previewPlan',
    requestId: 'preview',
    pageId: 'page',
    previewId: 'plan',
    accountKey: 'x:generated',
  },
  {
    type: 'setCriteria',
    requestId: 'criteria',
    criteria: { selected: ['political'], custom: [], nextCustom: 1, level: 0 },
  },
  { type: 'setKeepRules', requestId: 'rules', keepRules: [] },
] as const;

test('slice 2 requests share one strict schema across worker, HTTP and desktop', () => {
  for (const schema of [
    WorkspaceRequestSchema,
    HttpReviewRequestSchema,
    DesktopRequestSchema,
  ])
    for (const request of feedRequests) {
      expect(schema.parse(request)).toEqual(request);
      expect(schema.safeParse({ ...request, approve: true }).success).toBe(
        false,
      );
    }
});

test('feed windows require exactly one location and at most 50 full cards', () => {
  const request = feedRequests[1];
  expect(
    WorkspaceRequestSchema.safeParse({ ...request, limit: 51 }).success,
  ).toBe(false);
  expect(
    WorkspaceRequestSchema.safeParse({ ...request, anchor: 'x:1' }).success,
  ).toBe(false);
  const { offset, ...anchor } = request;
  void offset;
  expect(WorkspaceRequestSchema.parse({ ...anchor, anchor: 'x:1' })).toEqual({
    ...anchor,
    anchor: 'x:1',
  });
  expect(WorkspaceRequestSchema.safeParse(anchor).success).toBe(false);
});

test('reply shapes reject oversized cards and settings never admit harmless or unclear selections', () => {
  expect(
    WorkspaceReplySchema.parse({
      type: 'feedCards',
      requestId: 'cards',
      total: 0,
      anchorIndex: null,
      cards: [],
    }),
  ).toEqual({
    type: 'feedCards',
    requestId: 'cards',
    total: 0,
    anchorIndex: null,
    cards: [],
  });
  expect(
    WorkspaceReplySchema.safeParse({
      type: 'feedCards',
      requestId: 'cards',
      total: 1,
      anchorIndex: -1,
      cards: [],
    }).success,
  ).toBe(false);
  for (const selected of [
    ['harmless'],
    ['unclear'],
    Array.from({ length: 33 }, (_, index) => `earlier-${index}`),
  ])
    expect(
      HttpReviewRequestSchema.safeParse({
        ...feedRequests[3],
        criteria: { ...feedRequests[3].criteria, selected },
      }).success,
    ).toBe(false);
});
