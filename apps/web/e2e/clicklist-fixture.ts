import type { WorkspaceV2, Item } from '@socialprune/core';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForApp } from './helpers.ts';

const now = '2026-10-01T12:00:00.000Z';
function item(
  id: string,
  platform: 'x' | 'instagram',
  kind: Item['kind'],
  createdAt: string,
  text: string,
): Item {
  return {
    id,
    platform,
    account: {
      key: `${platform}:invented-clicklist`,
      handle: `invented_${platform}`,
    },
    kind,
    createdAt,
    text,
    mediaCount: null,
    engagement: { likes: null, reposts: null },
    reference: {
      replyToId: kind === 'reply' ? '999' : null,
      replyToHandle: null,
      quotedId: kind === 'quote' ? '888' : null,
      repostOfHandle: kind === 'repost' ? 'invented_original' : null,
      ownerHandle: platform === 'instagram' ? 'invented_owner' : null,
    },
    url:
      platform === 'x'
        ? `https://x.com/invented_x/status/${id.split(':').at(-1)}`
        : null,
    provenance: {
      archive: 'invented-clicklist',
      file: 'invented.json',
      index: 0,
    },
  };
}
export function clickListFixture(): WorkspaceV2 {
  const items = [
    item('x:101', 'x', 'post', '2026-03-28T22:30:00.000Z', '=1+1'),
    item(
      'x:102',
      'x',
      'repost',
      '2026-03-28T23:30:00.000Z',
      'Invented repost.',
    ),
    item('x:103', 'x', 'quote', '2026-03-29T00:30:00.000Z', 'Invented quote.'),
    item('x:104', 'x', 'reply', '2026-03-29T01:30:00.000Z', 'Invented reply.'),
    item(
      'instagram:101',
      'instagram',
      'comment',
      '2026-03-28T22:30:00.000Z',
      'Invented comment before Berlin midnight.',
    ),
    item(
      'instagram:102',
      'instagram',
      'comment',
      '2026-03-28T23:30:00.000Z',
      'Invented comment after Berlin midnight.',
    ),
    item(
      'instagram:103',
      'instagram',
      'comment',
      '2026-03-29T00:30:00.000Z',
      'Invented comment before the DST change.',
    ),
    item(
      'instagram:104',
      'instagram',
      'comment',
      '2026-03-29T01:30:00.000Z',
      'Invented comment after the DST change.',
    ),
  ];
  const keepItem = item(
    'x:105',
    'x',
    'post',
    '2026-03-30T12:00:00.000Z',
    'Invented kept post, not in the click list.',
  );
  const allItems = [...items, keepItem];
  return {
    format: 'socialprune-workspace',
    schemaVersion: 2,
    id: 'invented-clicklist-workspace',
    kind: 'personal',
    createdAt: now,
    updatedAt: now,
    lastBackupAt: now,
    settings: { categories: ['unclear'], timeZone: 'Europe/Berlin' },
    imports: [],
    items: allItems,
    submissions: [],
    assessments: [
      {
        assessmentId: 'invented-high-risk',
        submissionId: null,
        itemId: 'x:102',
        source: { kind: 'rules', name: 'invented-risk-fixture', version: '1' },
        category: 'unclear',
        risk: 3,
        reason: 'Invented high-risk ordering example.',
        evidence: null,
        confidence: null,
        createdAt: now,
      },
    ],
    decisionEvents: allItems.map((value, index) => ({
      eventId: `mark-${index}`,
      seq: index + 1,
      itemId: value.id,
      value: value.id === 'x:105' ? 'keep' : 'delete',
      previous: 'undecided',
      source: { kind: 'human', via: 'web-review' },
      decidedAt: now,
      action: {
        id: `marked-action-${index}`,
        kind: 'single',
        size: 1,
        reverts: null,
      },
    })),
    outcomeEvents: [],
    counts: {
      imports: 0,
      items: allItems.length,
      assessments: 1,
      submissions: 0,
      decisionEvents: allItems.length,
      outcomeEvents: 0,
    },
  };
}
export const expectedXIds = ['x:102', 'x:104', 'x:103', 'x:101'];
export const expectedBerlinDays = {
  'instagram:101': '2026-03-28',
  'instagram:102': '2026-03-29',
  'instagram:103': '2026-03-29',
  'instagram:104': '2026-03-29',
};
export const expectedUtcDays = {
  'instagram:101': '2026-03-28',
  'instagram:102': '2026-03-28',
  'instagram:103': '2026-03-29',
  'instagram:104': '2026-03-29',
};
export async function restoreClickLists(
  page: Page,
  fixture = clickListFixture(),
) {
  await waitForApp(page);
  const response = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'invented-clicklist-backup.json'),
      }),
    JSON.stringify(fixture),
  );
  expect(response.type).toBe('opened');
  return fixture;
}
