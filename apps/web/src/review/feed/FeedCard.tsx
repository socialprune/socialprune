import { useId } from 'react';
import { evidenceSegments } from '../model.ts';
import { useIntl } from 'react-intl';
import {
  Bookmark,
  Check,
  CheckCheck,
  Circle,
  Heart,
  Image,
  MessageCircle,
  Pause,
  Quote,
  Repeat2,
  ShieldCheck,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import type {
  FeedCardModel,
  FeedDecision,
  FeedPost,
  FeedPlatform,
  FeedSuggestion,
} from './types.ts';
import styles from './Feed.module.css';
import controls from './Controls.module.css';
import { InstagramComment } from './InstagramComment.tsx';

const levels = [
  'review.riskNone',
  'review.riskLow',
  'review.riskMedium',
  'review.riskHigh',
] as const;

export function avatarInitials(name: string, handle: string): string {
  const words = (name.trim() || handle.trim()).split(/\s+/u);
  return words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

export function sourceLabel(
  source: FeedSuggestion['source'],
  t: ReturnType<typeof useT>,
) {
  if (source.kind === 'agent')
    return t('review.agent', { name: source.name ?? '' });
  if (source.kind === 'model')
    return t('review.modelSource', { name: source.name ?? '' });
  return t(
    source.kind === 'example' ? 'review.example' : 'reviewFeed.wordLists',
  );
}

export function EvidenceText({
  text,
  evidence,
}: {
  text: string;
  evidence?: string;
}) {
  const index = evidence ? text.indexOf(evidence) : -1;
  if (index < 0 || !evidence) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{evidence}</mark>
      {text.slice(index + evidence.length)}
    </>
  );
}

function Byline({
  post,
  id,
  zone,
}: {
  post: FeedPost;
  id?: string;
  zone: string;
}) {
  const intl = useIntl();
  return (
    <div className={styles.byline} id={id}>
      <strong dir="auto">{post.name}</strong>
      <span dir="ltr">@{post.handle}</span>
      <time dateTime={post.createdAt}>
        {intl.formatDate(post.createdAt, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: zone,
        })}
      </time>
    </div>
  );
}

function ContextPost({ post, zone }: { post: FeedPost; zone: string }) {
  return (
    <div className={styles.contextPost}>
      <Byline post={post} zone={zone} />
      <p dir="auto">{post.text}</p>
    </div>
  );
}

export function FeedCard({
  card,
  position,
  total,
  zone = 'Europe/Berlin',
  singleKeys = true,
  showLater = true,
  platform = 'x',
  onDecision,
  onConversation,
  context,
  measure,
  virtualIndex,
}: {
  card: FeedCardModel;
  position: number;
  total: number;
  zone?: string;
  singleKeys?: boolean;
  showLater?: boolean;
  platform?: FeedPlatform;
  onDecision: (id: string, value: FeedDecision) => void;
  onConversation?: (id: string) => void;
  context?: React.ReactNode;
  measure?: (element: HTMLElement | null) => void;
  virtualIndex?: number;
}) {
  const t = useT(),
    intl = useIntl(),
    id = useId();
  const decided = card.decision !== 'undecided';
  const canMark = card.decision !== 'delete' && !card.deleted;
  const Icon = card.deleted
    ? CheckCheck
    : card.decision === 'keep'
      ? Check
      : card.decision === 'delete'
        ? Bookmark
        : card.decision === 'later'
          ? Pause
          : Circle;
  const date = card.decidedAt
    ? intl.formatDate(card.decidedAt, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: zone,
      })
    : '';
  const state = card.deleted
    ? t('reviewFeed.deleted', {
        platform: platform === 'x' ? 'X' : 'Instagram',
      })
    : card.decision === 'keep'
      ? t('reviewFeed.kept', { date })
      : card.decision === 'delete'
        ? t('reviewFeed.marked', {
            date,
            method: card.markedVia === 'final' ? 'final' : 'single',
          })
        : t('review.later');
  return (
    <article
      ref={measure}
      data-index={virtualIndex}
      className={styles.card}
      data-decided={decided}
      data-decision={card.decision}
      data-deleted={!!card.deleted}
      data-card-id={card.id}
      data-item-id={card.id}
      data-testid="feed-card"
      tabIndex={0}
      aria-labelledby={`${id}-byline`}
      aria-describedby={
        card.suggestions.length ? `${id}-suggestion` : undefined
      }
      aria-posinset={position}
      aria-setsize={total}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          !singleKeys ||
          event.repeat ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          card.busy ||
          card.deleted
        )
          return;
        const key = event.key.toLowerCase();
        const value: FeedDecision | undefined =
          key === 'k'
            ? 'keep'
            : key === 'l'
              ? 'later'
              : key === 'm'
                ? 'delete'
                : key === 'u'
                  ? 'undecided'
                  : undefined;
        if (value) {
          event.preventDefault();
          onDecision(card.id, value);
        }
      }}
    >
      {platform === 'instagram' && card.kind === 'comment' ? (
        <InstagramComment
          card={card}
          bylineId={`${id}-byline`}
          zone={zone}
          context={context}
        />
      ) : (
        <>
          {!!card.replyContext?.length && (
            <details className={styles.thread}>
              <summary className={styles.contextLabel}>
                <MessageCircle size={16} aria-hidden="true" />
                <span>{t('reviewFeed.conversation')}</span>
                <span className={styles.contextTeaser} dir="auto">
                  {card.replyContext.at(-1)!.text}
                </span>
              </summary>
              <div className={styles.threadContent}>
                {card.replyContext.slice(-2).map((post) => (
                  <ContextPost key={post.id} post={post} zone={zone} />
                ))}
                {!!onConversation && (card.conversationCount ?? 0) > 2 && (
                  <button
                    className={styles.textButton}
                    onClick={() => onConversation(card.id)}
                  >
                    {t('reviewFeed.thread', { count: card.conversationCount! })}
                  </button>
                )}
              </div>
            </details>
          )}
          {card.kind === 'reply' && context}
          <div className={styles.post}>
            <span className={styles.avatar} aria-hidden="true">
              {avatarInitials(card.name, card.handle)}
            </span>
            <div className={styles.postBody}>
              <Byline post={card} id={`${id}-byline`} zone={zone} />
              {card.replyTo && (
                <p className={styles.reply}>
                  {t(
                    card.kind === 'comment'
                      ? 'proto.commentAt'
                      : 'proto.replyTo',
                    { handle: card.replyTo },
                  )}
                </p>
              )}
              {card.kind === 'repost' && (
                <p className={styles.contextLabel}>
                  <Repeat2 size={16} aria-hidden="true" />
                  {t('review.repost')}
                </p>
              )}
              <p className={styles.postText} dir="auto">
                {evidenceSegments(
                  card.text ||
                    t(card.mediaCount ? 'review.mediaOnly' : 'review.noText'),
                  card.suggestions.map(
                    (suggestion) => suggestion.evidence ?? null,
                  ),
                ).map((part, index) =>
                  part.highlight ? (
                    <mark key={index}>{part.text}</mark>
                  ) : (
                    part.text
                  ),
                )}
              </p>
              {card.kind !== 'reply' && context}
              {card.quote && (
                <section
                  className={styles.quote}
                  aria-label={t('reviewFeed.quoted')}
                >
                  <div className={styles.contextLabel}>
                    <Quote size={16} aria-hidden="true" />
                    {t('reviewFeed.quoted')}
                  </div>
                  <ContextPost post={card.quote} zone={zone} />
                </section>
              )}
              {card.contextMissing && (
                <p className={styles.meta}>
                  {t(
                    card.kind === 'comment'
                      ? 'proto.instagramMissingPost'
                      : 'reviewFeed.missingContext',
                  )}
                </p>
              )}
              {!!card.mediaCount && (
                <p className={styles.media}>
                  <Image size={20} aria-hidden="true" />
                  {t('review.mediaCount', { count: card.mediaCount })}
                </p>
              )}
              <div className={styles.engagement}>
                <span>
                  <MessageCircle size={16} aria-hidden="true" />
                  {t(
                    card.kind === 'reply'
                      ? 'review.reply'
                      : card.kind === 'comment'
                        ? 'review.comment'
                        : 'review.post',
                  )}
                </span>
                <span>
                  <Repeat2 size={16} aria-hidden="true" />
                  {t('proto.reposts', { count: card.reposts ?? -1 })}
                </span>
                <span>
                  <Heart size={16} aria-hidden="true" />
                  {t('review.likesValue', { count: card.likes ?? -1 })}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
      <div className={styles.reviewBody}>
        <div id={`${id}-suggestion`} className={styles.suggestions}>
          {card.suggestions.map((suggestion) => (
            <div key={suggestion.id} className={styles.suggestion}>
              <div className={styles.suggestionLine}>
                <WandSparkles size={16} aria-hidden="true" />
                <strong>
                  {t(
                    suggestion.unclear
                      ? 'review.categoryUnclear'
                      : suggestion.harmless
                        ? 'review.categoryHarmless'
                        : 'reviewFeed.suggestDelete',
                  )}
                </strong>
                <span>{suggestion.category}</span>
                <span>{t(levels[suggestion.level])}</span>
                <span className={styles.source}>
                  {sourceLabel(suggestion.source, t)}
                </span>
              </div>
              <p dir="auto">{suggestion.reason}</p>
              {suggestion.ownCriterion && (
                <p className={styles.meta}>{t('reviewFeed.own')}</p>
              )}
            </div>
          ))}
          {!card.suggestions.length && (
            <p className={styles.meta}>{t('review.noSuggestions')}</p>
          )}
        </div>
        {!!card.heldBy.length && (
          <div className={styles.held}>
            {card.heldBy.map((rule) => (
              <p key={rule.id}>
                <ShieldCheck size={18} aria-hidden="true" />
                <span>
                  {t('reviewFeed.heldBy', {
                    value: rule.value,
                    rule: rule.rule,
                  })}
                </span>
              </p>
            ))}
          </div>
        )}
        {(decided || card.deleted) && (
          <p className={styles.decision}>
            <Icon size={18} aria-hidden="true" />
            {state}
          </p>
        )}
        {!card.deleted && (
          <div className={styles.actions}>
            {decided && card.decision !== 'later' ? (
              <button
                className={controls.button}
                disabled={card.busy}
                onClick={() => onDecision(card.id, 'undecided')}
              >
                <Undo2 size={18} aria-hidden="true" />
                {t('reviewFeed.reset')}
                <kbd>U</kbd>
              </button>
            ) : (
              <>
                <button
                  data-keep-action
                  className={`${controls.primary} ${styles.keepButton}`}
                  disabled={card.busy}
                  onClick={() => onDecision(card.id, 'keep')}
                >
                  <Check size={18} aria-hidden="true" />
                  {t('review.keep')}
                  <kbd>K</kbd>
                </button>
                {showLater &&
                  card.decision !== 'later' &&
                  !card.heldBy.length && (
                    <button
                      data-later-action
                      className={controls.quiet}
                      disabled={card.busy}
                      onClick={() => onDecision(card.id, 'later')}
                    >
                      <Pause size={18} aria-hidden="true" />
                      {t('review.later')}
                      <kbd>L</kbd>
                    </button>
                  )}
              </>
            )}
            {canMark && (
              <button
                data-mark-action
                className={`${controls.quiet} ${styles.markButton}`}
                disabled={card.busy}
                aria-describedby={`${id}-mark-help`}
                onClick={() => onDecision(card.id, 'delete')}
              >
                <Bookmark size={18} aria-hidden="true" />
                {t(
                  card.heldBy.length
                    ? 'reviewFeed.markAnyway'
                    : 'reviewFeed.mark',
                )}
                <kbd>M</kbd>
              </button>
            )}
            <span className={styles.srOnly} id={`${id}-mark-help`}>
              {t('reviewFeed.localOnly', {
                platform: platform === 'x' ? 'X' : 'Instagram',
              })}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
