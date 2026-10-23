import { useLayoutEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import type { FeedCounts, FeedTab } from './types.ts';
import styles from './Feed.module.css';

const tabs = [
  ['suggested', 'reviewFeed.tab.suggested', 'reviewFeed.shortSuggested'],
  ['held', 'reviewFeed.tab.held', 'reviewFeed.shortHeld'],
  ['kept', 'reviewFeed.tab.kept', 'reviewFeed.tab.kept'],
  ['unclear', 'reviewFeed.tab.unclear', 'reviewFeed.tab.unclear'],
  ['marked', 'reviewFeed.tab.marked', 'reviewFeed.tab.marked'],
  ['all', 'reviewFeed.tab.all', 'reviewFeed.tab.all'],
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
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  function measure() {
    const node = list.current;
    if (node)
      setEdges({
        before: node.scrollLeft > 2,
        after: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
      });
  }
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const selected = node.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected) {
      const box = selected.getBoundingClientRect(),
        view = node.getBoundingClientRect();
      if (box.left < view.left) node.scrollLeft -= view.left - box.left;
      else if (box.right > view.right)
        node.scrollLeft += box.right - view.right;
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab]);
  return (
    <div className={styles.tabNavigation}>
      <button
        className={styles.tabScroll}
        data-tab-scroll="previous"
        aria-label={t('reviewFeed.previousTabs')}
        disabled={!edges.before}
        onClick={() => {
          list.current?.scrollBy({ left: -(list.current.clientWidth * 0.75) });
        }}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <div
        ref={list}
        role="tablist"
        aria-label={t('reviewFeed.tabs')}
        className={styles.tabs}
        onScroll={measure}
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
          event.currentTarget
            .querySelectorAll<HTMLButtonElement>('[role="tab"]')
            [next]?.focus();
        }}
      >
        {tabs.map(([key, full, short]) => (
          <button
            type="button"
            key={key}
            role="tab"
            id={`${panelId}-${key}`}
            aria-controls={panelId}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            aria-label={t('reviewFeed.tabCount', {
              tab: t(full),
              count: counts[key],
            })}
            onClick={() => onTab(key)}
          >
            <span>{t(short)}</span>
            <span className={styles.count}>
              {intl.formatNumber(counts[key])}
            </span>
          </button>
        ))}
      </div>
      <button
        className={styles.tabScroll}
        data-tab-scroll="next"
        aria-label={t('reviewFeed.nextTabs')}
        disabled={!edges.after}
        onClick={() => {
          list.current?.scrollBy({ left: list.current.clientWidth * 0.75 });
        }}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
