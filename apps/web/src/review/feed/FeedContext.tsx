import type { Item, Original } from '@socialprune/core';
import { useIntl } from 'react-intl';
import type { WorkspaceClient } from '../../workspace/client.ts';
import { StoredMedia, Conversation } from '../../social/Conversation.tsx';
import { InstagramPostContext } from '../../social/InstagramPost.tsx';
import { originalDisplayText } from '../../social/originalText.ts';
import { originalXLink } from '../../social/originalLink.ts';
import { useT } from '../../i18n/index.ts';
import styles from './Feed.module.css';
import { ClampedText } from './ClampedText.tsx';

export function FeedContext({
  item,
  client,
  zone,
  original,
}: {
  item: Item;
  client: WorkspaceClient;
  zone: string;
  original?: Original | null;
}) {
  const t = useT(),
    intl = useIntl();
  const reference =
    item.kind === 'reply'
      ? item.reference.replyToId
      : item.kind === 'quote'
        ? item.reference.quotedId
        : null;
  if (item.platform === 'instagram' && item.kind === 'comment')
    return (
      <InstagramPostContext
        variant="feed"
        item={item}
        client={client}
        zone={zone}
        fallback={
          <p className={styles.meta}>{t('proto.instagramMissingPost')}</p>
        }
      />
    );
  if (!reference) return null;
  const link = originalXLink(reference);
  const text = original ? originalDisplayText(original) : null;
  const readable =
    original &&
    (original.signedIn?.status === 'read' ||
      (!original.signedIn && original.anonymous?.status === 'fetched'));
  return (
    <section className={styles.thread} data-testid="stored-original">
      <p className={styles.contextLabel}>
        {t(
          item.kind === 'quote'
            ? 'reviewFeed.quoted'
            : 'reviewFeed.conversation',
        )}
      </p>
      {original && text && (
        <>
          <strong>
            {original.authorName}{' '}
            {original.authorHandle && `@${original.authorHandle}`}
          </strong>
          <ClampedText>{text}</ClampedText>
          <div className={styles.contextMedia}>
            <StoredMedia original={original} />
          </div>
        </>
      )}
      {readable ? (
        <>
          <span className={styles.meta}>
            {t(
              original.textCompleteness === 'full'
                ? 'originals.full'
                : original.textCompleteness === 'truncated'
                  ? 'originals.truncated'
                  : 'originals.completenessUnknown',
            )}
          </span>{' '}
          <span className={styles.meta}>
            {t(
              original.textSource === 'signed-in'
                ? 'originals.sourceSignedIn'
                : 'originals.sourceAnonymous',
              {
                date: intl.formatDate(
                  original.signedIn?.at ?? original.anonymous!.at,
                  {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: zone,
                  },
                ),
              },
            )}
          </span>
          <Conversation id={original.id} client={client} />
        </>
      ) : (
        <p>
          {t(
            original?.signedIn?.status === 'unavailable'
              ? 'originals.unavailable'
              : original?.anonymous?.status === 'not-found'
                ? 'originals.notFound'
                : 'reviewFeed.missingContext',
          )}
        </p>
      )}
      {link && (
        <>
          {readable && <span aria-hidden="true">{' · '}</span>}
          <a href={link} target="_blank" rel="noopener noreferrer">
            {t('proto.viewOriginalX')}
          </a>
        </>
      )}
    </section>
  );
}
