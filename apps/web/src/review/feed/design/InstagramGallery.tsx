import { useState } from 'react';
import type { InstagramContext } from '@socialprune/core';
import { FeedCard } from '../FeedCard.tsx';
import { BeforeFeedCard } from './BeforeFeedCard.tsx';
import { InstagramPost } from '../../../social/InstagramPost.tsx';
import { examples, instagramCard, instagramReadPost } from './examples.ts';
import type { SheetLocale } from './examples.ts';
import type { FeedDecision } from '../types.ts';
import styles from './InstagramGallery.module.css';

export const instagramGalleryCases = [
  'x',
  'image',
  'screenshot',
  'list',
  'unread',
  'owner',
  'long',
] as const;
export type InstagramGalleryCase = (typeof instagramGalleryCases)[number];

export function galleryRecord(
  kind: InstagramGalleryCase,
  locale: SheetLocale,
): InstagramContext | null {
  if (kind === 'x' || kind === 'unread') return null;
  const record = instagramReadPost(locale);
  if (kind === 'screenshot') {
    record.image = { file: null, host: null, status: 'not-captured' };
    record.screenshot = { file: 'shot.jpg', bytes: 2048, status: 'stored' };
  }
  if (kind === 'owner') record.ownerCheck = 'not-in-export';
  if (kind === 'list')
    return {
      ...record,
      confirmedBy: 'list',
      comment: { id: null, createdAt: null, expandClicks: 0 },
    };
  return record;
}

/** Generated comparison cases; no workspace or platform connection. */
export function InstagramGallery({
  locale,
  kind,
  before,
}: {
  locale: SheetLocale;
  kind: InstagramGalleryCase;
  before: boolean;
}) {
  const [decision, setDecision] = useState<FeedDecision>('undecided');
  const record = galleryRecord(kind, locale);
  const base =
    kind === 'x'
      ? {
          ...examples(locale).suggested[0]!,
          kind: 'post' as const,
          replyTo: undefined,
          replyContext: undefined,
          conversationCount: undefined,
        }
      : {
          ...instagramCard(locale),
          ...(kind === 'owner' ? { replyTo: undefined } : {}),
        };
  const text =
    kind === 'long'
      ? (locale === 'de'
          ? 'Ein erfundener längerer Kommentar über den Park und die nächste Sitzung im Gemeinderat. Wir sollten auch die Leute fragen, die hier jeden Tag zu Fuß unterwegs sind. '
          : 'An invented longer comment about the park and the next council meeting. We should also ask the people who walk here every day. '
        ).repeat(6)
      : base.text;
  const Card = before ? BeforeFeedCard : FeedCard;
  return (
    <main className={styles.gallery}>
      <h1>
        {locale === 'de'
          ? 'Instagram-Karten im Vergleich'
          : 'Instagram card comparison'}
      </h1>
      <p>
        {locale === 'de'
          ? 'Erfundene Beiträge, keine gespeicherten Entscheidungen.'
          : 'Invented posts, no saved decisions.'}
      </p>
      <div
        role="feed"
        aria-label={locale === 'de' ? 'Designvergleich' : 'Design comparison'}
      >
        <Card
          card={{
            ...base,
            text,
            contextMissing: !record && kind !== 'x',
            decision,
          }}
          position={1}
          total={1}
          platform={kind === 'x' ? 'x' : 'instagram'}
          context={
            record ? (
              <InstagramPost
                record={record}
                variant={before ? 'full' : 'feed'}
                zone="Europe/Berlin"
              />
            ) : undefined
          }
          onDecision={(_id, value) => setDecision(value)}
        />
      </div>
    </main>
  );
}
