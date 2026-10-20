import { useId, useLayoutEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import {
  Bookmark,
  Check,
  CircleHelp,
  Layers,
  ListFilter,
  ShieldCheck,
} from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import { FeedCard } from './FeedCard.tsx';
import type {
  FeedCardModel,
  FeedCounts,
  FeedDecision,
  FeedPlatform,
  FeedTab,
} from './types.ts';
import styles from './Feed.module.css';

const tabs = [
  ['suggested', 'reviewFeed.tab.suggested', ListFilter],
  ['held', 'reviewFeed.tab.held', ShieldCheck],
  ['kept', 'reviewFeed.tab.kept', Check],
  ['unclear', 'reviewFeed.tab.unclear', CircleHelp],
  ['marked', 'reviewFeed.tab.marked', Bookmark],
  ['all', 'reviewFeed.tab.all', Layers],
] as const;

export function FeedTabs({
  tab,
  counts,
  onTab,
  panelId,
}: {
  tab: FeedTab;
  counts: FeedCounts;
  onTab: (tab: FeedTab) => void;
  panelId: string;
}) {
  const t = useT(),
    intl = useIntl();
  const tabList = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = tabList.current,
      selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    const offset = selected.offsetLeft;
    if (
      offset < list.scrollLeft ||
      offset + selected.offsetWidth > list.scrollLeft + list.clientWidth
    )
      list.scrollLeft = offset;
  }, [tab]);
  return (
    <div
      ref={tabList}
      role="tablist"
      aria-label={t('reviewFeed.tabs')}
      className={styles.tabs}
      onKeyDown={(event) => {
        const index = tabs.findIndex(([key]) => key === tab);
        const next =
          event.key === 'ArrowRight'
            ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft'
              ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        onTab(tabs[next]![0]);
        const buttons =
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]',
          );
        buttons[next]?.focus();
      }}
    >
      {tabs.map(([key, message, Icon]) => (
        <button
          type="button"
          key={key}
          role="tab"
          id={`${panelId}-${key}`}
          aria-controls={panelId}
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          aria-label={t('reviewFeed.tabCount', {
            tab: t(message),
            count: counts[key],
          })}
          onClick={() => onTab(key)}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{t(message)}</span>
          <span className={styles.count}>{intl.formatNumber(counts[key])}</span>
        </button>
      ))}
    </div>
  );
}

export function FinalMarkFooter({
  count,
  held,
  marked = false,
  disabled = false,
  onPreview,
  platform = 'x',
  footerRef,
}: {
  count: number;
  held: number;
  marked?: boolean;
  disabled?: boolean;
  onPreview: () => void;
  platform?: FeedPlatform;
  footerRef?: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  return (
    <footer ref={footerRef} className={styles.finalFooter}>
      <p className={styles.footerHelp}>
        {marked
          ? t(
              platform === 'x'
                ? 'reviewFeed.waitingX'
                : 'reviewFeed.waitingInstagram',
              { count },
            )
          : t('reviewFeed.localOnly', {
              platform: platform === 'x' ? 'X' : 'Instagram',
            })}
      </p>
      <button
        className={marked ? styles.primary : styles.finalButton}
        disabled={disabled || count === 0}
        onClick={onPreview}
        aria-describedby="feed-final-detail"
      >
        <Bookmark size={20} aria-hidden="true" />
        {marked
          ? t(
              platform === 'x'
                ? 'reviewFeed.deleteOnX'
                : 'reviewFeed.openClickList',
            )
          : t('reviewFeed.markRest', { count })}
      </button>
      <span className={styles.srOnly} id="feed-final-detail">
        {t('reviewFeed.rest', { count })}{' '}
        {t('reviewFeed.heldCount', { count: held })}{' '}
        {t('reviewFeed.finalHelp', {
          platform: platform === 'x' ? 'X' : 'Instagram',
        })}
      </span>
    </footer>
  );
}

export interface ReviewFeedProps {
  account: string;
  criteria: string;
  hasCriteria?: boolean;
  platform?: FeedPlatform;
  /** Q7 is intentionally not decided by this presentation component. */
  laterExcluded?: boolean;
  counts: FeedCounts;
  tab: FeedTab;
  cards: readonly FeedCardModel[];
  unchecked?: { count: number; criterion: string };
  busy?: boolean;
  error?: boolean;
  notice?: string;
  singleKeys?: boolean;
  zone?: string;
  onTab: (tab: FeedTab) => void;
  onCriteria: () => void;
  onCheck: () => void;
  onRetry: () => void;
  onDecision: (id: string, value: FeedDecision) => void;
  onPreview: () => void;
  onDelete: () => void;
  onConversation?: (id: string) => void;
  onUndo?: () => void;
  onKeyboardHelp?: () => void;
}
export function ReviewFeed(props: ReviewFeedProps) {
  const t = useT(),
    id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const hasCriteria = props.hasCriteria ?? true;
  useLayoutEffect(() => {
    const panel = panelRef.current,
      footer = footerRef.current;
    if (!panel || !footer) return;
    const update = () => {
      panel.style.paddingBottom = `${footer.getBoundingClientRect().height}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      panel.style.paddingBottom = '';
    };
  }, [props.tab, hasCriteria]);
  const active = tabs.find(([key]) => key === props.tab)!;
  return (
    <section className={styles.review}>
      <header className={styles.feedHeader}>
        <div className={styles.titleRow}>
          <h1>{t('review.title')}</h1>
          <span className={styles.account} dir="ltr">
            @{props.account}
          </span>
        </div>
        <div className={styles.criteriaSummary}>
          <span>{t('reviewFeed.looking', { criteria: props.criteria })}</span>
          <button className={styles.textButton} onClick={props.onCriteria}>
            {t('reviewFeed.changeShort')}
          </button>
        </div>
      </header>
      <FeedTabs
        tab={props.tab}
        counts={props.counts}
        onTab={props.onTab}
        panelId={id}
      />
      <div
        ref={panelRef}
        className={styles.scrollPanel}
        role="tabpanel"
        id={id}
        aria-labelledby={`${id}-${props.tab}`}
      >
        {props.unchecked && hasCriteria && (
          <div className={styles.unchecked}>
            <CircleHelp size={18} aria-hidden="true" />
            <span title={t('reviewFeed.notChecked', props.unchecked)}>
              {t('reviewFeed.notChecked', props.unchecked)}
            </span>
            <button className={styles.textButton} onClick={props.onCheck}>
              {t('reviewFeed.checkNow')}
            </button>
          </div>
        )}
        {(props.tab === 'unclear' || props.tab === 'held') && (
          <p className={styles.tabHelp}>
            {t(
              props.tab === 'held'
                ? 'reviewFeed.heldHelp'
                : props.laterExcluded === false
                  ? 'reviewFeed.unclearHelpIncluded'
                  : 'reviewFeed.unclearHelp',
            )}
          </p>
        )}
        <div
          className={styles.feed}
          role="feed"
          aria-label={t(active[1])}
          aria-busy={!!props.busy}
          onKeyDown={(event) => {
            if (
              !(event.target instanceof HTMLElement) ||
              event.target.tagName !== 'ARTICLE'
            )
              return;
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === 'z' &&
              !event.repeat &&
              props.onUndo
            ) {
              event.preventDefault();
              props.onUndo();
              return;
            }
            if (
              event.key === '?' &&
              props.singleKeys !== false &&
              !event.repeat &&
              props.onKeyboardHelp
            ) {
              event.preventDefault();
              props.onKeyboardHelp();
              return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat)
              return;
            const articles = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                ':scope > article',
              ),
            ];
            const current = articles.indexOf(event.target);
            const next =
              event.key === 'ArrowDown' || event.key === 'PageDown'
                ? Math.min(articles.length - 1, current + 1)
                : event.key === 'ArrowUp' || event.key === 'PageUp'
                  ? Math.max(0, current - 1)
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? articles.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              articles[next]?.focus();
            }
          }}
        >
          {!hasCriteria ? (
            <div className={styles.empty}>
              <h2>{t('reviewFeed.noCriteria')}</h2>
              <button onClick={props.onCriteria}>
                {t('reviewFeed.chooseCriteria')}
              </button>
            </div>
          ) : props.busy ? (
            <div className={styles.loading} role="status">
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
              <p>{t('gate.preparing')}</p>
            </div>
          ) : props.error ? (
            <div className={styles.empty} role="alert">
              <h2>{t('reviewFeed.error')}</h2>
              <button onClick={props.onRetry}>{t('reviewFeed.retry')}</button>
            </div>
          ) : !props.cards.length ? (
            <div className={styles.empty}>
              <Check size={24} aria-hidden="true" />
              <h2>{t('reviewFeed.empty')}</h2>
              <p>{t('reviewFeed.emptyHelp')}</p>
              <button onClick={props.onCriteria}>
                {t('reviewFeed.change')}
              </button>
            </div>
          ) : (
            props.cards.map((card, index) => (
              <FeedCard
                key={card.id}
                card={card}
                position={index + 1}
                total={props.counts[props.tab]}
                zone={props.zone}
                singleKeys={props.singleKeys}
                showLater={props.tab === 'suggested'}
                onDecision={props.onDecision}
                onConversation={props.onConversation}
                platform={props.platform}
              />
            ))
          )}
        </div>
        <p
          role="status"
          aria-live="polite"
          className={props.notice ? styles.notice : styles.srOnly}
        >
          {props.notice ?? ''}
        </p>
      </div>
      {hasCriteria && (props.tab === 'suggested' || props.tab === 'marked') && (
        <FinalMarkFooter
          count={props.counts[props.tab]}
          held={props.counts.held}
          marked={props.tab === 'marked'}
          disabled={props.busy || props.error}
          onPreview={props.tab === 'marked' ? props.onDelete : props.onPreview}
          platform={props.platform}
          footerRef={footerRef}
        />
      )}
    </section>
  );
}
