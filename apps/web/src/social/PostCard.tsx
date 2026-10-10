import {
  Heart,
  Repeat2,
  MessageCircle,
  Image,
  Check,
  Quote,
} from 'lucide-react';
import { useIntl } from 'react-intl';
import type { Item, OutcomeValue } from '@socialprune/core';
import { useT } from '../i18n/index.ts';
import styles from './Social.module.css';

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
}: {
  item: Item;
  outcome?: OutcomeValue;
  children?: React.ReactNode;
  threaded?: boolean;
  zone?: string;
}) {
  const t = useT(),
    intl = useIntl();
  const handle = item.account.handle ?? item.account.key;
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
          {item.kind === 'quote' && (
            <div className={styles.quote}>
              <Quote size={16} aria-hidden="true" />
              <span>{t('proto.quoteNote')}</span>
            </div>
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
          {outcome === 'deleted-by-user' && (
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
