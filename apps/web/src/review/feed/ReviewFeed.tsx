import { memo, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import { focusWhenReady } from './focus.ts';
import type {
  FeedCardModel,
  FeedCounts,
  FeedDecision,
  FeedPlatform,
  FeedTab,
} from './types.ts';
import styles from './Feed.module.css';
import { FeedTabs as ScrollableFeedTabs } from './FeedTabs.tsx';
import controls from './Controls.module.css';

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
  return (
    <ScrollableFeedTabs
      tab={tab}
      counts={counts}
      onTab={onTab}
      panelId={panelId}
    />
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
        {marked ? (
          t(
            platform === 'x'
              ? 'reviewFeed.waitingX'
              : 'reviewFeed.waitingInstagram',
            { count },
          )
        ) : (
          <>
            {t('reviewFeed.rest', { count })}.{' '}
            {t('reviewFeed.finalHelp', {
              platform: platform === 'x' ? 'X' : 'Instagram',
            })}
          </>
        )}
      </p>
      <button
        className={
          marked ? controls.primary : `${controls.danger} ${styles.finalButton}`
        }
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
  onUndo?: (redo?: boolean) => void;
  onDrain?: () => Promise<void>;
  decisionKeysBlockedUntil?: number;
  onKeyboardHelp?: () => void;
  header?: React.ReactNode;
  context?: (card: FeedCardModel) => React.ReactNode;
  start?: number;
  total?: number;
  onMove?: (index: number) => void;
  onAnchor?: (id: string) => void;
  onNextWindow?: () => void;
  onPreviousWindow?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  virtualized?: boolean;
  onVisible?: (ids: readonly string[]) => void | (() => void);
  focusTarget?: { id: string; sequence: number } | null;
}
const MountedFeedCard = memo(function MountedFeedCard({
  card,
  busy,
  context,
  ...props
}: Omit<React.ComponentProps<typeof FeedCard>, 'context'> & {
  busy?: boolean;
  context?: ReviewFeedProps['context'];
}) {
  return (
    <FeedCard
      {...props}
      card={busy ? { ...card, busy: true } : card}
      context={context?.(card)}
    />
  );
});
export function ReviewFeed(props: ReviewFeedProps) {
  const t = useT(),
    id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || props.virtualized !== false) return;
    const measure = () =>
      panel.style.setProperty(
        '--feed-single-height',
        `${Math.max(300, panel.clientHeight - 4)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      panel.style.removeProperty('--feed-single-height');
    };
  }, [props.virtualized]);
  const virtualizer = useVirtualizer({
    count: props.cards.length,
    getScrollElement: () => panelRef.current,
    estimateSize: () => 480,
    getItemKey: (index) => props.cards[index]!.id,
    overscan: 10,
    enabled: !!props.virtualized,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const completedFocus = useRef<number | null>(null);
  const keyboardOwnsFocus = useRef(false);
  useEffect(() => {
    const document = panelRef.current?.ownerDocument;
    const release = () => {
      keyboardOwnsFocus.current = false;
    };
    document?.addEventListener('pointerdown', release, true);
    document?.addEventListener('keydown', release, true);
    return () => {
      document?.removeEventListener('pointerdown', release, true);
      document?.removeEventListener('keydown', release, true);
    };
  }, []);
  const windowStart = useRef(props.start);
  useLayoutEffect(() => {
    if (windowStart.current === props.start) return;
    windowStart.current = props.start;
    if (!keyboardOwnsFocus.current) return;
    // Retention rebases local virtual indices without changing the person's
    // destination. Its previous focus acknowledgement no longer covers layout.
    completedFocus.current = null;
    const index = props.cards.findIndex(
      (card) => card.id === props.focusTarget?.id,
    );
    if (props.virtualized && index >= 0)
      virtualizer.scrollToIndex(index, { align: 'start', behavior: 'instant' });
  }, [
    props.start,
    props.cards,
    props.focusTarget,
    props.virtualized,
    virtualizer,
  ]);
  useEffect(() => {
    if (
      !props.focusTarget ||
      props.focusTarget.sequence === completedFocus.current
    )
      return;
    const index = props.cards.findIndex(
      (card) => card.id === props.focusTarget!.id,
    );
    if (index < 0) return;
    keyboardOwnsFocus.current = true;
    const sequence = props.focusTarget.sequence;
    const panel = panelRef.current;
    const cancel = focusWhenReady({
      find: () =>
        [
          ...(panelRef.current?.querySelectorAll<HTMLElement>(
            'article[data-card-id]',
          ) ?? []),
        ].find(
          (article) => article.dataset['cardId'] === props.focusTarget!.id,
        ),
      scroll: () => {
        if (props.virtualized)
          virtualizer.scrollToIndex(index, {
            align: 'start',
            behavior: 'instant',
          });
      },
      active: () => panel?.ownerDocument.activeElement ?? null,
      panel: () => panelRef.current,
      frame: requestAnimationFrame,
      cancelFrame: cancelAnimationFrame,
      complete: () => {
        completedFocus.current = sequence;
      },
    });
    // A person's newer input supersedes a pending automatic focus operation.
    const supersede = () => {
      cancel();
      keyboardOwnsFocus.current = false;
      completedFocus.current = sequence;
    };
    const document = panel?.ownerDocument;
    document?.addEventListener('pointerdown', supersede, {
      once: true,
      capture: true,
    });
    document?.addEventListener('keydown', supersede, {
      once: true,
      capture: true,
    });
    return () => {
      cancel();
      document?.removeEventListener('pointerdown', supersede, true);
      document?.removeEventListener('keydown', supersede, true);
    };
  }, [
    props.focusTarget,
    visibleKeyForFocus(virtualItems),
    props.cards,
    props.virtualized,
    virtualizer,
  ]);
  const visibleKey = (
    props.virtualized
      ? virtualItems.map((item) => props.cards[item.index]!.id)
      : props.cards.map((card) => card.id)
  ).join('\n');
  useEffect(
    () => props.onVisible?.(visibleKey ? visibleKey.split('\n') : []),
    [visibleKey, props.onVisible],
  );
  const hasCriteria = props.hasCriteria ?? true;
  useLayoutEffect(() => {
    const panel = panelRef.current,
      footer = footerRef.current;
    if (!panel || !footer) return;
    const update = () => {
      panel.style.paddingBottom = `${Math.ceil(footer.getBoundingClientRect().height)}px`;
      panel.style.setProperty(
        '--feed-footer-clearance',
        panel.style.paddingBottom,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      panel.style.paddingBottom = '';
      panel.style.removeProperty('--feed-footer-clearance');
    };
  }, [props.tab, hasCriteria]);
  const active = tabs.find(([key]) => key === props.tab)!;
  return (
    <section className={styles.review} aria-label={t('reviewFeed.planHeading')}>
      {props.header}
      {hasCriteria && (
        <header className={styles.feedHeader}>
          <div className={styles.criteriaSummary}>
            <span>
              {hasCriteria
                ? t('reviewFeed.looking', { criteria: props.criteria })
                : t('reviewFeed.noCriteria')}
            </span>
            <button className={controls.quiet} onClick={props.onCriteria}>
              {t('reviewFeed.changeShort')}
            </button>
          </div>
        </header>
      )}
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
        tabIndex={-1}
        id={id}
        aria-labelledby={`${id}-${props.tab}`}
        onScroll={(event) => {
          const panel = event.currentTarget;
          const top = panel.getBoundingClientRect().top;
          const first = [
            ...panel.querySelectorAll<HTMLElement>('article[data-card-id]'),
          ].find((card) => card.getBoundingClientRect().bottom > top);
          if (first?.dataset['cardId'])
            props.onAnchor?.(first.dataset['cardId']);
          if (
            props.hasNext &&
            !props.busy &&
            !props.error &&
            panel.scrollHeight - panel.scrollTop - panel.clientHeight < 250
          )
            props.onNextWindow?.();
        }}
      >
        {props.unchecked && hasCriteria && (
          <div className={styles.unchecked}>
            <CircleHelp size={18} aria-hidden="true" />
            <span title={t('reviewFeed.notChecked', props.unchecked)}>
              {t('reviewFeed.notChecked', props.unchecked)}
            </span>
            <button className={controls.quiet} onClick={props.onCheck}>
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
          onKeyDownCapture={(event) => {
            if (
              /^[kmlu]$/i.test(event.key) &&
              (performance.now() < (props.decisionKeysBlockedUntil ?? 0) ||
                event.repeat)
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onKeyDown={(event) => {
            if (
              !(event.target instanceof HTMLElement) ||
              event.target.tagName !== 'ARTICLE'
            )
              return;
            if (
              event.ctrlKey &&
              (event.key === 'Home' || event.key === 'End')
            ) {
              event.preventDefault();
              if (event.key === 'Home')
                (
                  panelRef.current
                    ?.closest('main')
                    ?.querySelector<HTMLElement>('h1') ??
                  panelRef.current
                    ?.closest('section')
                    ?.querySelector<HTMLElement>(
                      '[role="tab"][aria-selected="true"]',
                    )
                )?.focus();
              else {
                const footerButton =
                  footerRef.current?.querySelector<HTMLButtonElement>('button');
                if (footerButton) {
                  footerButton.focus();
                  if (footerButton.disabled)
                    void props
                      .onDrain?.()
                      .then(() =>
                        requestAnimationFrame(() =>
                          requestAnimationFrame(() => footerButton.focus()),
                        ),
                      );
                } else {
                  panelRef.current?.focus({ preventScroll: true });
                  if (panelRef.current)
                    panelRef.current.scrollTop = panelRef.current.scrollHeight;
                }
              }
              return;
            }
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === 'z' &&
              !event.repeat &&
              props.onUndo
            ) {
              event.preventDefault();
              props.onUndo(event.shiftKey);
              return;
            }
            if (
              event.ctrlKey &&
              event.key.toLowerCase() === 'y' &&
              props.onUndo
            ) {
              event.preventDefault();
              props.onUndo(true);
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
                'article[data-card-id]',
              ),
            ];
            const current = articles.indexOf(event.target);
            if (props.onMove) {
              const absolute =
                (props.start ?? 0) +
                props.cards.findIndex(
                  (card) =>
                    card.id === (event.target as HTMLElement).dataset['cardId'],
                );
              const target =
                event.key === 'End'
                  ? Math.max(0, (props.total ?? props.cards.length) - 1)
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'ArrowDown' || event.key === 'PageDown'
                      ? absolute + 1
                      : event.key === 'ArrowUp' || event.key === 'PageUp'
                        ? absolute - 1
                        : -1;
              if (target >= 0) {
                event.preventDefault();
                props.onMove(target);
                return;
              }
            }
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
          {!hasCriteria && props.tab === 'suggested' ? (
            <div className={styles.empty}>
              <h2>{t('reviewFeed.noCriteria')}</h2>
              <p>{t('reviewFeed.emptyStart')}</p>
              <button className={controls.primary} onClick={props.onCriteria}>
                {t('reviewFeed.chooseCriteria')}
              </button>
            </div>
          ) : props.busy && !props.cards.length ? (
            <div className={styles.loading} role="status">
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
              <p>{t('gate.preparing')}</p>
            </div>
          ) : props.error ? (
            <div className={styles.empty} role="alert">
              <h2>{t('reviewFeed.error')}</h2>
              <button className={controls.button} onClick={props.onRetry}>
                {t('reviewFeed.retry')}
              </button>
            </div>
          ) : !props.cards.length ? (
            <div className={styles.empty}>
              <Check size={24} aria-hidden="true" />
              <h2>{t('reviewFeed.empty')}</h2>
              <p>{t('reviewFeed.emptyHelp')}</p>
              <button className={controls.button} onClick={props.onCriteria}>
                {t('reviewFeed.change')}
              </button>
            </div>
          ) : (
            <>
              {props.virtualized && !!virtualItems.length && (
                <div
                  aria-hidden="true"
                  style={{ height: virtualItems[0]!.start }}
                />
              )}
              {(props.virtualized
                ? virtualItems.map((item) => ({
                    card: props.cards[item.index]!,
                    index: item.index,
                  }))
                : props.cards.map((card, index) => ({ card, index }))
              ).map(({ card, index }) => (
                <MountedFeedCard
                  key={card.id}
                  card={card}
                  busy={props.busy}
                  position={(props.start ?? 0) + index + 1}
                  total={props.total ?? props.counts[props.tab]}
                  zone={props.zone}
                  singleKeys={props.singleKeys}
                  showLater={props.tab === 'suggested'}
                  onDecision={props.onDecision}
                  onConversation={props.onConversation}
                  platform={props.platform}
                  context={props.context}
                  measure={
                    props.virtualized ? virtualizer.measureElement : undefined
                  }
                  virtualIndex={props.virtualized ? index : undefined}
                  single={props.virtualized === false}
                />
              ))}
              {props.virtualized && !!virtualItems.length && (
                <div
                  aria-hidden="true"
                  style={{
                    height: Math.max(
                      0,
                      virtualizer.getTotalSize() - virtualItems.at(-1)!.end,
                    ),
                  }}
                />
              )}
            </>
          )}
        </div>
        {props.hasPrevious && (
          <button
            className={styles.windowButton}
            onClick={props.onPreviousWindow}
          >
            {t('reviewFeed.previousWindow')}
          </button>
        )}
        {props.hasNext && (
          <button
            className={styles.windowButton}
            disabled={props.busy}
            onClick={props.onNextWindow}
          >
            {t('reviewFeed.nextWindow')}
          </button>
        )}
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

function visibleKeyForFocus(items: readonly { index: number }[]) {
  return items.map((item) => item.index).join(',');
}
