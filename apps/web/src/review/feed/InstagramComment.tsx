import { useIntl } from 'react-intl';
import { evidenceSegments } from '../model.ts';
import { useT } from '../../i18n/index.ts';
import type { FeedCardModel } from './types.ts';
import styles from './InstagramComment.module.css';
import { ClampedText } from './ClampedText.tsx';

/** Instagram usernames allow dots and up to thirty characters. */
export function commentText(text: string): { own: string; mentions: string } {
  const prefix = /^\s*(?:@[A-Za-z0-9_.]{1,30}\s+)+/u.exec(text)?.[0];
  return prefix && text.slice(prefix.length).trim()
    ? { own: text.slice(prefix.length), mentions: prefix.trim() }
    : { own: text, mentions: '' };
}

/** The platform's reading grammar, without platform actions or invented counts. */
export function InstagramComment({
  card,
  bylineId,
  zone,
  context,
  display,
}: {
  card: FeedCardModel;
  bylineId: string;
  zone: string;
  context?: React.ReactNode;
  display?: { own: string; mentions: string };
}) {
  const t = useT(),
    intl = useIntl();
  const text = (value: string) =>
    evidenceSegments(
      value || t('review.noText'),
      card.suggestions.map((suggestion) => suggestion.evidence ?? null),
    ).map((part, index) =>
      part.highlight ? <mark key={index}>{part.text}</mark> : part.text,
    );
  const author = (
    <strong id={bylineId} dir="ltr">
      {card.handle}
    </strong>
  );
  return (
    <div className={styles.content} data-instagram-comment>
      <div className={styles.context}>
        {context ?? (
          <p className={styles.missing}>{t('proto.instagramMissingPost')}</p>
        )}
      </div>
      <div className={styles.comment} data-own-comment>
        <span className={styles.avatar} aria-hidden="true">
          {card.handle.slice(0, 2).toLocaleUpperCase()}
        </span>
        <div className={styles.body}>
          {display && (
            <div className={styles.commentByline}>
              {author}
              {display.mentions && (
                <span className={styles.mentions} dir="auto">
                  {display.mentions}
                </span>
              )}
            </div>
          )}
          <ClampedText
            className={styles.text}
            primary
            collapsedChildren={
              display?.mentions ? text(display.own) : undefined
            }
          >
            {!display && <>{author} </>}
            {text(card.text)}
          </ClampedText>
          <div className={styles.metadata}>
            <time dateTime={card.createdAt}>
              {intl.formatDate(card.createdAt, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: zone,
              })}
            </time>
            {card.replyTo && (
              <span dir="auto" data-instagram-owner>
                {t('proto.commentAt', { handle: card.replyTo })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
