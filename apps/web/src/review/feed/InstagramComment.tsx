import { useIntl } from 'react-intl';
import { evidenceSegments } from '../model.ts';
import { useT } from '../../i18n/index.ts';
import type { FeedCardModel } from './types.ts';
import styles from './InstagramComment.module.css';

/** The platform's reading grammar, without platform actions or invented counts. */
export function InstagramComment({
  card,
  bylineId,
  zone,
  context,
}: {
  card: FeedCardModel;
  bylineId: string;
  zone: string;
  context?: React.ReactNode;
}) {
  const t = useT(),
    intl = useIntl();
  return (
    <div className={styles.content} data-instagram-comment>
      <div className={styles.context}>
        {context ?? (
          <p className={styles.missing}>{t('proto.instagramMissingPost')}</p>
        )}
      </div>
      <div className={styles.comment}>
        <span className={styles.avatar} aria-hidden="true">
          {card.handle.slice(0, 2).toLocaleUpperCase()}
        </span>
        <div className={styles.body}>
          <p className={styles.text} dir="auto">
            <strong id={bylineId} dir="ltr">
              {card.handle}
            </strong>{' '}
            {evidenceSegments(
              card.text || t('review.noText'),
              card.suggestions.map((suggestion) => suggestion.evidence ?? null),
            ).map((part, index) =>
              part.highlight ? <mark key={index}>{part.text}</mark> : part.text,
            )}
          </p>
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
