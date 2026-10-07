import type { Item } from './model/index.ts';
export const timestamp = '2026-01-02T03:04:05.000Z';
export function sampleItem(id = 'x:123', platform = 'x'): Item {
  return {
    id,
    platform,
    account: { key: `${platform}:account`, handle: null },
    kind: 'post',
    text: 'Generated text.',
    createdAt: timestamp,
    mediaCount: null,
    engagement: { likes: null, reposts: null },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    url: null,
    provenance: { archive: 'demo', file: 'posts.json', index: 0 },
  };
}
