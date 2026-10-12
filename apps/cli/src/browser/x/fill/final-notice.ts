import { object } from '@socialprune/core';

export type FinalNotice = 'deleted' | 'suspended' | 'accountGone';
export type FinalNoticeCounts = Record<FinalNotice, number>;

/** Only known English tombstone sentences qualify; changed wording stays planned. */
export function finalNotice(answer: unknown): FinalNotice | null {
  const raw = object(answer);
  if (raw.__typename !== 'TweetTombstone' && raw.type !== 'tombstone')
    return null;
  const tombstone = object(raw.tombstone);
  const text = object(tombstone.text).text ?? object(tombstone.richText).text;
  if (typeof text !== 'string') return null;
  const notice = text
    .trim()
    .toLowerCase()
    .replace(/\.(?: learn more\.?)?$/, '');
  switch (notice) {
    case 'this post was deleted by the post author':
      return 'deleted';
    case 'this post is from a suspended account':
      return 'suspended';
    case 'this post is from an account that no longer exists':
      return 'accountGone';
    default:
      return null;
  }
}

export function finalNoticeText(
  counts: FinalNoticeCounts,
  lang: 'en' | 'de',
): string {
  const { deleted, suspended, accountGone } = counts;
  return lang === 'de'
    ? `Der Plan lässt ${deleted} gelöschte Beiträge, ${suspended} Beiträge gesperrter Konten und ${accountGone} Beiträge nicht mehr vorhandener Konten aus, weil X sie einem angemeldeten Konto genauso zeigt.`
    : `The plan leaves out ${deleted} deleted posts, ${suspended} posts from suspended accounts and ${accountGone} posts from accounts that no longer exist because X shows these the same way to a signed-in account.`;
}
