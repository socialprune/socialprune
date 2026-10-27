import { useId, useLayoutEffect, useRef, useState } from 'react';
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
import { ClampedText } from './ClampedText.tsx';

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
  single = false,
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
  single?: boolean;
}) {
  const t = useT(),
    intl = useIntl(),
    id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (!single || !content.current) return;
    const node = content.current;
    const revealDetails = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement && event.target.open)
        setExpanded(true);
    };
    const revealText = (event: Event) =>
      setExpanded((event as CustomEvent<boolean>).detail);
    node.addEventListener('toggle', revealDetails, true);
    node.addEventListener('card-text-expansion', revealText);
    return () => {
      node.removeEventListener('toggle', revealDetails, true);
      node.removeEventListener('card-text-expansion', revealText);
    };
  }, [single, expanded, card.text, context]);
  const decided = card.decision !== 'undecided';
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
      data-instagram-card={
        platform === 'instagram' && card.kind === 'comment' ? '' : undefined
      }
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
      <CardContent
        single={single}
        contentRef={content}
        expanded={expanded}
        id={`${id}-content`}
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
                      {t('reviewFeed.thread', {
                        count: card.conversationCount!,
                      })}
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
                <div className={styles.metadataLine}>
                  <Byline post={card} id={`${id}-byline`} zone={zone} />
                  <span>
                    {t(
                      card.kind === 'reply'
                        ? 'review.reply'
                        : card.kind === 'quote'
                          ? 'review.quote'
                          : card.kind === 'repost'
                            ? 'review.repost'
                            : 'review.post',
                    )}
                  </span>
                  {card.replyTo && (
                    <span>{t('proto.replyTo', { handle: card.replyTo })}</span>
                  )}
                  <span>
                    <Heart size={14} aria-hidden="true" />
                    {t('review.likesValue', { count: card.likes ?? -1 })}
                  </span>
                  <span>
                    <Repeat2 size={14} aria-hidden="true" />
                    {t('proto.reposts', { count: card.reposts ?? -1 })}
                  </span>
                </div>
                <ClampedText className={styles.postText} primary>
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
                </ClampedText>
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
                  <p dir="auto">
                    <strong>
                      {t(
                        suggestion.unclear
                          ? 'review.categoryUnclear'
                          : suggestion.harmless
                            ? 'review.categoryHarmless'
                            : 'reviewFeed.suggestDelete',
                      )}
                    </strong>
                    {' · '}
                    {suggestion.category}
                    {' · '}
                    {t(levels[suggestion.level])}
                    {' · '}
                    {sourceLabel(suggestion.source, t)}
                  </p>
                </div>
                <p className={styles.suggestionReason}>{suggestion.reason}</p>
              </div>
            ))}
            {!card.suggestions.length && (
              <p className={styles.meta}>{t('review.noSuggestions')}</p>
            )}
            {!!card.suggestions.length && (
              <details className={styles.suggestionDetails}>
                <summary>{t('review.detail')}</summary>
                {card.suggestions.map((suggestion) => (
                  <div key={suggestion.id}>
                    <p>
                      {suggestion.category} · {t(levels[suggestion.level])} ·{' '}
                      {sourceLabel(suggestion.source, t)}
                    </p>
                    {suggestion.evidence && (
                      <p>
                        <q>{suggestion.evidence}</q>
                      </p>
                    )}
                    {suggestion.ownCriterion && <p>{t('reviewFeed.own')}</p>}
                  </div>
                ))}
              </details>
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
          {!single && (
            <FeedActions
              card={card}
              single={false}
              showLater={showLater}
              platform={platform}
              onDecision={onDecision}
              id={id}
            />
          )}
        </div>
      </CardContent>
      {single && (
        <FeedActions
          card={card}
          single
          showLater={showLater}
          platform={platform}
          onDecision={onDecision}
          id={id}
        />
      )}
    </article>
  );
}

function CardContent({
  single,
  contentRef,
  expanded,
  id,
  children,
}: {
  single: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
  expanded: boolean;
  id: string;
  children: React.ReactNode;
}) {
  return single ? (
    <div
      ref={contentRef}
      className={styles.cardContent}
      data-card-content
      data-expanded={expanded}
      id={id}
    >
      {children}
    </div>
  ) : (
    <>{children}</>
  );
}

function FeedActions({
  card,
  single,
  showLater,
  platform,
  onDecision,
  id,
}: {
  card: FeedCardModel;
  single: boolean;
  showLater: boolean;
  platform: FeedPlatform;
  onDecision: (id: string, value: FeedDecision) => void;
  id: string;
}) {
  const t = useT();
  const decided = card.decision !== 'undecided';
  const canMark = card.decision !== 'delete' && !card.deleted;
  return (
    !card.deleted && (
      <div className={styles.actions}>
        {platform === 'instagram' && card.kind === 'comment' && (
          <p
            className={styles.commentExcerpt}
            role="note"
            aria-label={t('review.comment')}
          >
            <strong>{card.handle}</strong> {card.text || t('review.noText')}
          </p>
        )}
        {decided && card.decision !== 'later' && !single ? (
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
              disabled={card.busy || card.decision === 'keep'}
              onClick={() => onDecision(card.id, 'keep')}
            >
              <Check size={18} aria-hidden="true" />
              {t('review.keep')}
              <kbd>K</kbd>
            </button>
            {(single ||
              (showLater &&
                card.decision !== 'later' &&
                !card.heldBy.length)) && (
              <button
                data-later-action
                className={controls.quiet}
                disabled={card.busy || card.decision === 'later'}
                onClick={() => onDecision(card.id, 'later')}
              >
                <Pause size={18} aria-hidden="true" />
                {t('review.later')}
                <kbd>L</kbd>
              </button>
            )}
          </>
        )}
        {(canMark || single) && (
          <button
            data-mark-action
            className={`${controls.quiet} ${styles.markButton}`}
            disabled={card.busy || card.decision === 'delete'}
            aria-describedby={`${id}-mark-help`}
            onClick={() => onDecision(card.id, 'delete')}
          >
            <Bookmark size={18} aria-hidden="true" />
            {t(
              card.heldBy.length ? 'reviewFeed.markAnyway' : 'reviewFeed.mark',
            )}
            <kbd>M</kbd>
          </button>
        )}
        {single && decided && (
          <button
            data-reset-action
            className={controls.quiet}
            disabled={card.busy}
            onClick={() => onDecision(card.id, 'undecided')}
          >
            <Undo2 size={18} aria-hidden="true" />
            {t('reviewFeed.reset')}
            <kbd>U</kbd>
          </button>
        )}
        <span className={styles.srOnly} id={`${id}-mark-help`}>
          {t('reviewFeed.localOnly', {
            platform: platform === 'x' ? 'X' : 'Instagram',
          })}
        </span>
      </div>
    )
  );
}
