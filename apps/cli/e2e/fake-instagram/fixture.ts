import { readFile } from 'node:fs/promises';
import type { Item, WorkspaceV2 } from '@socialprune/core';
import { createWorkspace } from '@socialprune/core/workspace/store';

export const IG_FIXTURE = {
  now: '2026-10-15T12:00:00.000Z',
  code: 'Generated_Aa-19',
  commentId: '191919191919191919',
  caption: 'Invented post caption with ferns and moss.',
  postAt: '2025-07-30T18:00:00.000Z',
  other: {
    username: 'planted_other_person',
    text: 'Other person private generated comment words 92',
    code: 'OtherSecret99',
    time: '2025-07-29T13:47:19.000Z',
  },
  // A tiny generated PNG, not read from a real page or export.
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ZkAAAAASUVORK5CYII=',
  expected: {
    success: ['sending', 'confirmed'],
    failure: ['sending', 'unconfirmed'],
    lowerBoundSteps: 1,
    emptyImageButtons: 3,
    yearAge: '8y',
    fullYearAge: '8 years',
  },
  allowedClicks: [
    'Sort & filter',
    'Oldest to newest',
    'Newest to oldest',
    'Apply',
    'Load more comments',
    'View replies',
    'Comment row',
  ],
} as const;
export async function instagramFixture(
  count = 1,
): Promise<{ workspace: WorkspaceV2; items: Item[] }> {
  const expected = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/instagram/current-minimal/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { items: Item[]; records: WorkspaceV2['imports'] };
  const item = expected.items[0]!;
  const items = Array.from({ length: count }, (_, index): Item => ({
    ...structuredClone(item),
    id: index ? `instagram:generated-${index}` : item.id,
    text: index ? `${item.text} Generated ${index}` : item.text,
    createdAt: new Date(
      Date.parse(item.createdAt) + index * 86400000,
    ).toISOString(),
    provenance: { ...item.provenance, archive: 'generated-instagram', index },
  }));
  const base = createWorkspace({
    id: 'generated-instagram-context',
    timeZone: 'Europe/Berlin',
    now: new Date(IG_FIXTURE.now),
  });
  const imported = expected.records[0]!;
  const workspace: WorkspaceV2 = {
    ...base,
    items,
    imports: [
      {
        ...imported,
        id: 'generated-ig-import',
        importedAt: IG_FIXTURE.now,
        archives: ['generated-instagram'],
        adapter: { name: 'generated', version: '1' },
        status: 'complete',
        itemCount: items.length,
      },
    ],
    counts: { ...base.counts, items: items.length, imports: 1 },
  };
  return { workspace, items };
}
export type Variant =
  | 'success'
  | 'hidden'
  | 'time'
  | 'owner'
  | 'several'
  | 'edited'
  | 'other-author'
  | 'reel'
  | 'video'
  | 'unavailable'
  | 'no-row'
  | 'window-full'
  | 'login'
  | 'challenge'
  | 'checkpoint'
  | 'lock'
  | 'limit'
  | 'error'
  | 'de'
  | '429'
  | 'never'
  | 'mutation'
  | 'write-segment'
  | 'external'
  | 'no-json'
  | 'missing-owner'
  | 'missing-time'
  | 'missing-caption'
  | 'missing-image'
  | 'different-owner'
  | 'different-time'
  | 'different-caption'
  | 'different-image'
  | 'two-answers'
  | 'cut-caption'
  | 'collaboration'
  | 'image-type'
  | 'image-large'
  | 'shot-large'
  | 'empty-caption'
  | 'second-candidate'
  | 'four-candidates'
  | 'post-decoy'
  | 'post-decoy-foreign'
  | 'multi-permalink'
  | 'account-mismatch'
  | 'side-429'
  | 'feedback-required'
  | 'please-wait'
  | 'checkpoint-required'
  | 'spam'
  | 'signal-metrics'
  | 'year-rows'
  | 'year-word-rows'
  | 'empty-image-buttons'
  | 'year-empty-rows'
  | 'filter-five'
  | 'filter-seven'
  | 'filter-no-start'
  | 'filter-no-end'
  | 'filter-readback'
  | 'filter-reordered'
  | 'filter-duplicate-option'
  | 'filter-unknown-month'
  | 'filter-wrong-group'
  | 'unknown-age';
