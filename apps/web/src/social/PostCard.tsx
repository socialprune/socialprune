import {
  Heart,
  Repeat2,
  MessageCircle,
  Image,
  Check,
  Quote,
  ExternalLink,
} from 'lucide-react';
import { useIntl } from 'react-intl';
import { useEffect, useState } from 'react';
import type { Item, OutcomeValue, Original } from '@socialprune/core';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import styles from './Social.module.css';
import { originalXLink } from './originalLink.ts';
import { isDeletedOnPlatform } from '../archive/model.ts';
import { StoredMedia, Conversation } from './Conversation.tsx';
import { originalDisplayText } from './originalText.ts';
import { InstagramPostContext } from './InstagramPost.tsx';

export function Avatar({
  handle,
  large = false,
}: {
  handle: string | null;
  large?: boolean;
}) {
  const initials = (handle ?? '?').replace(/^@/, '').slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${large ? styles.largeAvatar : ''}`}
    >
      {initials}
    </span>
  );
}

export function PostCard({
  item,
  outcome,
  children,
  threaded = false,
  zone,
  client,
}: {
  item: Item;
  outcome?: OutcomeValue;
  children?: React.ReactNode;
  threaded?: boolean;
  zone?: string;
  client?: WorkspaceClient;
}) {
  const t = useT(),
    intl = useIntl();
  const handle = item.account.handle ?? item.account.key;
  const originalId =
    item.platform === 'x'
      ? item.kind === 'reply'
        ? item.reference.replyToId
        : item.kind === 'quote'
          ? item.reference.quotedId
          : null
      : null;
  const [storedState, setStored] = useState<{
    client: WorkspaceClient;
    original: Original | null;
  } | null>(null);
  const workspace = client ?? window.workspace;
  const stored =
    storedState?.client === workspace ? storedState.original : null;
  useEffect(() => {
    let active = true;
    if (originalId && /^[0-9]{1,40}$/.test(originalId) && workspace) {
      void workspace
        .getOriginals([originalId])
        .then((originals) => {
          if (active)
            setStored({
              client: workspace,
              original:
                originals.find((entry) => entry.id === originalId) ?? null,
            });
        })
        .catch(() => {
          if (active) setStored(null);
        });
    }
    return () => {
      active = false;
    };
  }, [originalId, workspace]);
  const original =
    item.platform === 'x'
      ? originalXLink(
          item.kind === 'reply'
            ? item.reference.replyToId
            : item.kind === 'quote'
              ? item.reference.quotedId
              : null,
        )
      : null;
  const ownReply =
    item.reference.replyToHandle?.replace(/^@/, '').toLowerCase() ===
    handle.replace(/^@/, '').toLowerCase();
  return (
    <article
      className={`${styles.post} ${threaded ? styles.threadPost : ''}`}
      data-item-id={item.id}
    >
      {item.kind === 'repost' && (
        <p className={styles.context}>
          <Repeat2 size={16} aria-hidden="true" />
          {t('proto.reposted', {
            handle: item.reference.repostOfHandle?.replace(/^@/, '') ?? handle,
          })}
        </p>
      )}
      <div className={styles.postLayout}>
        <Avatar handle={handle} />
        <div className={styles.postBody}>
          <div className={styles.byline}>
            <strong>{handle.replace(/^@/, '')}</strong>
            <span>@{handle.replace(/^@/, '')}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.createdAt}>
              {intl.formatDate(item.createdAt, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: zone,
              })}
            </time>
          </div>
          {item.kind === 'reply' &&
            item.reference.replyToHandle &&
            !ownReply && (
              <p className={styles.reply}>
                {t('proto.replyTo', {
                  handle: item.reference.replyToHandle.replace(/^@/, ''),
                })}
              </p>
            )}
          {item.kind === 'comment' && (
            <p className={styles.reply}>
              {t('proto.commentAt', {
                handle:
                  item.reference.ownerHandle?.replace(/^@/, '') ??
                  t('proto.unknownOwner'),
              })}
            </p>
          )}
          <p className={styles.postText} dir="auto">
            {item.text ||
              t(item.mediaCount ? 'review.mediaOnly' : 'review.noText')}
          </p>
          {item.kind === 'quote' && stored?.id !== originalId && (
            <div className={styles.quote}>
              <Quote size={16} aria-hidden="true" />
              <span>{t('proto.quoteNote')}</span>
            </div>
          )}
          {original && (
            <a
              className={styles.originalLink}
              href={original}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              {t('proto.viewOriginalX')}
            </a>
          )}
          {stored && stored.id === originalId && (
            <section
              className={styles.original}
              data-testid="stored-original"
              aria-label={t('originals.heading')}
            >
              {stored.signedIn?.status === 'read' ||
              (!stored.signedIn && stored.anonymous?.status === 'fetched') ? (
                <>
                  <div className={styles.byline}>
                    <Avatar handle={stored.authorHandle} />
                    <strong>{stored.authorName}</strong>
                    <span>@{stored.authorHandle}</span>
                  </div>
                  <p className={styles.postText} dir="auto">
                    {originalDisplayText(stored)}
                  </p>
                  <StoredMedia original={stored} />
                  <p className={styles.hint}>
                    {t(
                      stored.textCompleteness === 'full'
                        ? 'originals.full'
                        : stored.textCompleteness === 'truncated'
                          ? 'originals.truncated'
                          : 'originals.completenessUnknown',
                    )}
                  </p>
                  <p className={styles.hint}>
                    {t(
                      stored.textSource === 'signed-in'
                        ? 'originals.sourceSignedIn'
                        : 'originals.sourceAnonymous',
                      {
                        date: intl.formatDate(
                          stored.signedIn?.at ?? stored.anonymous!.at,
                          { day: 'numeric', month: 'long', year: 'numeric' },
                        ),
                      },
                    )}
                  </p>
                  {workspace && (
                    <Conversation id={stored.id} client={workspace} />
                  )}
                </>
              ) : (
                <>
                  <p className={styles.hint}>
                    {t(
                      stored.signedIn?.status === 'unavailable'
                        ? 'originals.unavailable'
                        : (stored.signedIn?.status ??
                              stored.anonymous?.status) === 'not-found'
                          ? 'originals.notFound'
                          : (stored.signedIn?.status ??
                                stored.anonymous?.status) === 'tombstone'
                            ? 'originals.tombstone'
                            : 'originals.failed',
                    )}
                  </p>
                  {stored.text && (
                    <>
                      <p className={styles.postText} dir="auto">
                        {originalDisplayText(stored)}
                      </p>
                      <StoredMedia original={stored} />
                    </>
                  )}
                </>
              )}
            </section>
          )}
          {item.platform === 'instagram' && item.kind === 'comment' && (
            <InstagramPostContext
              item={item}
              client={workspace}
              zone={zone}
              fallback={
                <p className={styles.hint}>{t('proto.instagramMissingPost')}</p>
              }
            />
          )}
          {!!item.mediaCount && (
            <div className={styles.media}>
              <Image size={22} aria-hidden="true" />
              {t('review.mediaCount', { count: item.mediaCount })}
            </div>
          )}
          <div className={styles.engagement}>
            <span>
              <MessageCircle size={18} aria-hidden="true" />
              {t(
                item.kind === 'comment'
                  ? 'review.comment'
                  : item.kind === 'reply'
                    ? 'review.reply'
                    : 'review.post',
              )}
            </span>
            <span
              aria-label={t('proto.reposts', {
                count: item.engagement.reposts ?? -1,
              })}
            >
              <Repeat2 size={18} aria-hidden="true" />
              {item.engagement.reposts === null
                ? t('proto.unknownCount')
                : intl.formatNumber(item.engagement.reposts)}
            </span>
            <span
              aria-label={t('review.likesValue', {
                count: item.engagement.likes ?? -1,
              })}
            >
              <Heart size={18} aria-hidden="true" />
              {item.engagement.likes === null
                ? t('proto.unknownCount')
                : intl.formatNumber(item.engagement.likes)}
            </span>
          </div>
          {outcome !== undefined && isDeletedOnPlatform(outcome) && (
            <span className={styles.deleted}>
              <Check size={16} aria-hidden="true" />
              {t(
                item.platform === 'x'
                  ? 'proto.deletedX'
                  : 'proto.deletedInstagram',
              )}
            </span>
          )}
          {children}
        </div>
      </div>
    </article>
  );
}
