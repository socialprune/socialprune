import { readFile } from 'node:fs/promises';
import type { Item, WorkspaceV2 } from '@socialprune/core';
import { createWorkspace } from '@socialprune/core/workspace/store';

export const IG_FIXTURE = {
  now: '2026-10-15T12:00:00.000Z',
  code: 'Generated_Aa-19',
  commentId: '191919191919191919',
  caption: 'Invented post caption with ferns and moss. #generated_fern',
  captionLine: 'Invented post caption with ferns and moss.',
  captionTag: '#generated_fern',
  commentTag: '#generated_moss',
  candidateCodes: [
    'Generated_candidate_1',
    'Generated_candidate_2',
    'Generated_candidate_3',
  ],
  scroll: { first: 1, beyondLimit: 11, maximum: 10, empty: 2, delta: 700 },
  postAt: '2025-07-30T18:00:00.000Z',
  ownerWithoutExport: 'generated_owner_without_export',
  other: {
    username: 'planted_other_person',
    text: 'Other person private generated comment words 92',
    code: 'OtherSecret99',
    time: '2025-07-29T13:47:19.000Z',
  },
  postDecoys: {
    collaborator: 'generated_collaborator',
    profileOnly: 'generated_profile_picture',
    secondText: 'Generated ambiguous outer text 73',
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
    otherNameRows: 3,
    accountFillers: 8,
    navigationDelayMs: 800,
    accountDeadlineDelayMs: 10000,
    framedDocuments: 5,
    framedCodeDocuments: 2,
    framedParameterObjects: 3,
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
export const POST_NOTICE_FIXTURE = {
  mediaId: '918181818181818181',
  prefixBytes: 512,
  maximumDeclaredBytes: 1048576,
  perStepBodies: 20,
  cases: [
    {
      variant: 'post-notice-bare',
      path: '/api/v1/media/918181818181818181/comments/',
      type: 'application/json',
      body: ' \r\nNot Found\t ',
      pathClass: 'api-v1-media-comments',
      bodyClass: 'bare-not-found',
    },
    {
      variant: 'post-notice-info-json',
      path: '/api/v1/media/918181818181818181/info/',
      type: 'application/json',
      body: JSON.stringify({ message: IG_FIXTURE.other.text }),
      pathClass: 'api-v1-media-info',
      bodyClass: 'json',
    },
    {
      variant: 'post-notice-html',
      path: '/api/v1/qe/expose/',
      type: 'text/html',
      body: `<html><body>${IG_FIXTURE.other.text}</body></html>`,
      pathClass: 'api-v1-other',
      bodyClass: 'html',
    },
    {
      variant: 'post-notice-empty',
      path: '/api/v1/media/918181818181818181/comments/191919191919191919/inline_child_comments/',
      type: 'text/plain',
      body: '',
      pathClass: 'api-v1-media-comments',
      bodyClass: 'empty',
    },
    {
      variant: 'post-notice-unreadable',
      path: '/api/v1/media/918181818181818181/comments/',
      type: 'text/plain',
      body: IG_FIXTURE.other.text,
      encoding: 'gzip',
      pathClass: 'api-v1-media-comments',
      bodyClass: 'unreadable',
    },
    {
      variant: 'post-notice-large',
      path: '/api/v1/media/918181818181818181/info/',
      type: 'application/json',
      body: '',
      padding: 1048577,
      pathClass: 'api-v1-media-info',
      bodyClass: 'large',
    },
    {
      variant: 'post-notice-cap',
      path: '/api/v1/media/918181818181818181/comments/',
      type: 'application/json',
      body: JSON.stringify({ message: IG_FIXTURE.other.text }),
      responses: 22,
      pathClass: 'api-v1-media-comments',
      bodyClass: 'json',
    },
  ],
} as const;
export type Variant =
  | 'success'
  | (typeof POST_NOTICE_FIXTURE.cases)[number]['variant']
  | 'post-notice-404'
  | 'post-notice-429'
  | 'post-notice-503'
  | 'answer-ndjson'
  | 'answer-concatenated'
  | 'answer-javascript'
  | 'answer-disagreement'
  | 'answer-unparsable'
  | 'answer-probe8-crlf'
  | 'answer-probe8-lf'
  | 'answer-probe8-concatenated'
  | 'answer-route-caption'
  | 'answer-real-disagreement'
  | 'list-other-names'
  | 'list-other-names-nav-late'
  | 'list-nav-other'
  | 'list-nav-missing'
  | 'list-nav-after-deadline'
  | 'list-nav-inside-main'
  | 'list-half-other'
  | 'list-majority-other'
  | 'list-no-own'
  | 'list-no-own-filtered'
  | 'list-nav-other-filtered'
  | 'list-nav-missing-filtered'
  | 'list-half-other-filtered'
  | 'list-majority-other-filtered'
  | 'own-link-flicker'
  | 'own-link-vanishes'
  | 'expansion-link-flicker'
  | 'expansion-link-vanishes'
  | 'expansion-post-switch'
  | 'expansion-kind-switch'
  | 'list-cut'
  | 'hidden'
  | 'scroll-first'
  | 'scroll-late'
  | 'scroll-never'
  | 'scroll-ten'
  | 'scroll-no-column'
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
  | 'owner-first-profile'
  | 'same-owner-links'
  | 'reel-links'
  | 'not-shown'
  | 'media-decoys'
  | 'block-two-texts'
  | 'block-no-text'
  | 'block-text-in-link'
  | 'block-two-profiles'
  | 'block-profile-label'
  | 'block-profile-image'
  | 'block-time-count'
  | 'block-wrong-depth'
  | 'block-wrong-code'
  | 'block-query-permalink'
  | 'comment-hashtag'
  | 'comment-mention'
  | 'block-text-time'
  | 'block-text-image'
  | 'block-text-button'
  | 'block-text-permalink'
  | 'block-old-two-level'
  | 'caption-no-text'
  | 'caption-extra-text'
  | 'caption-no-wrapper'
  | 'caption-no-time'
  | 'caption-linked-time'
  | 'caption-text-button'
  | 'post-no-own-time'
  | 'post-other-code'
  | 'post-two-main'
  | 'owner-picture-profile'
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
