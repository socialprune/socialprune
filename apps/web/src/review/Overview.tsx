import { useEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Check, Pause, Star, Trash2, Undo2, Sparkles } from 'lucide-react';
import type { Assessment, DecisionValue, ReviewView } from '@socialprune/core';
import type {
  ItemDetail,
  WorkspaceSummary,
  QuerySort,
} from '@socialprune/core/workspace/protocol';
import type { CSSProperties } from 'react';
import { deriveState } from '@socialprune/core/workspace/state';
import type { WorkspaceClient } from '../workspace/client.ts';
import { requestId } from '../social/workspace.ts';
import { PostCard } from '../social/PostCard.tsx';
import { useT } from '../i18n/index.ts';
import { categoryID, decisionMessage, riskMessage } from './model.ts';
import { Filters } from './Filters.tsx';
import type { Template } from './filters.ts';
import { ReviewViewWriter, initialReviewView } from './view.ts';
import social from '../social/Social.module.css';
import styles from './Overview.module.css';

export const OVERVIEW_SORT: QuerySort = [
  { by: 'risk', direction: 'desc' },
  { by: 'likes', direction: 'desc' },
  { by: 'createdAt', direction: 'desc' },
  { by: 'id', direction: 'asc' },
];
interface Entry {
  detail: ItemDetail;
  decision: DecisionValue;
  suggestions: Assessment[];
}
function entry(detail: ItemDetail): Entry {
  const state = deriveState({
    items: [detail.item],
    assessments: detail.assessments,
    decisionEvents: detail.events.filter((event) => 'decidedAt' in event),
    outcomeEvents: detail.events.filter((event) => 'recordedAt' in event),
  }).get(detail.item.id)!;
  return {
    detail,
    decision: state.decision,
    suggestions: state.assessments.slice().sort((a, b) => b.risk - a.risk),
  };
}
function initialView(
  client: WorkspaceClient,
  summary: WorkspaceSummary | null,
  accountKey: string,
): ReviewView {
  const restored = initialReviewView(summary, (value) =>
    client.parseReviewView(value),
  );
  const baseline =
    JSON.stringify(restored.sort) ===
    JSON.stringify(initialReviewView(null, () => undefined).sort);
  return {
    ...restored,
    accountKey,
    sort: baseline ? OVERVIEW_SORT : restored.sort,
  };
}

export function ReviewModes({
  mode,
  onChange,
}: {
  mode: 'single' | 'all';
  onChange: (mode: 'single' | 'all') => void;
}) {
  const t = useT();
  return (
    <div className={styles.modes} role="group" aria-label={t('feed.mode')}>
      <button
        aria-pressed={mode === 'single'}
        onClick={() => onChange('single')}
      >
        {t('feed.single')}
      </button>
      <button aria-pressed={mode === 'all'} onClick={() => onChange('all')}>
        {t('feed.all')}
      </button>
    </div>
  );
}

export function Overview({
  client,
  summary,
  revision,
  accountKey,
  onAccount,
  onSingle,
  onBulk,
  popular,
  threshold,
  popularityError,
}: {
  client: WorkspaceClient;
  summary: WorkspaceSummary | null;
  revision: number;
  accountKey: string;
  onAccount: (key: string) => void;
  onSingle: () => void;
  onBulk: () => void;
  popular: ReadonlySet<string>;
  threshold: number | null;
  popularityError: boolean;
}) {
  const t = useT();
  const [view, setView] = useState(() =>
    initialView(client, summary, accountKey),
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template>('none');
  const [focusIndex, setFocusIndex] = useState(0);
  const [onlyPopular, setOnlyPopular] = useState(false);
  const [writer] = useState(
    () =>
      new ReviewViewWriter((next) => {
        void client
          .request({
            type: 'setReviewView',
            requestId: requestId(),
            view: next,
          })
          .then((reply) => {
            if (reply.type !== 'reviewViewChanged') setError(true);
          })
          .catch(() => setError(true));
      }),
  );
  const sequence = useRef(0),
    refreshSequence = useRef(0);
  const command = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const waiting = entries.filter(
    (value) =>
      value.decision === 'undecided' && popular.has(value.detail.item.id),
  );
  const shown = onlyPopular ? waiting : entries;
  const useVirtual = shown.length > 60;
  const viewport = useRef<HTMLDivElement>(null);
  const zone =
    summary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const virtualizer = useVirtualizer({
    count: useVirtual ? shown.length : 0,
    getScrollElement: () => viewport.current,
    estimateSize: () => 510,
    overscan: 3,
    getItemKey: (index) => shown[index]?.detail.item.id ?? index,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          Math.min(focusIndex, Math.max(0, shown.length - 1)),
        ]),
      ].sort((a, b) => a - b),
    useAnimationFrameWithResizeObserver: true,
  });
  useEffect(() => () => writer.flush(), [writer]);
  useEffect(() => {
    const version = ++sequence.current;
    refreshSequence.current++;
    setLoading(true);
    setEntries([]);
    setError(false);
    setFocusIndex(0);
    void (async () => {
      if (
        (view.filter.decisions &&
          !view.filter.decisions.includes('undecided')) ||
        view.filter.risk?.unknown === 'only' ||
        (view.filter.risk?.max ?? 3) < 2
      )
        return;
      const queryId = requestId();
      const result = await client.request({
        type: 'query',
        requestId: requestId(),
        queryId,
        generation: 1,
        accountKey,
        filter: {
          ...view.filter,
          decisions: ['undecided'],
          risk: {
            min: Math.max(2, view.filter.risk?.min ?? 2),
            max: Math.min(3, view.filter.risk?.max ?? 3),
            unknown: 'exclude',
          },
        },
        sort: view.sort,
        search: view.search,
      });
      if (result.type !== 'queryResult')
        throw new Error('Overview query rejected');
      const all: Entry[] = [];
      for (let offset = 0; offset < result.total; offset += 200) {
        if (sequence.current !== version) return;
        const window = await client.request({
          type: 'window',
          requestId: requestId(),
          queryId,
          generation: 1,
          offset,
          limit: 200,
        });
        if (window.type !== 'rows') throw new Error('Overview window rejected');
        for (let start = 0; start < window.rows.length; start += 12) {
          if (sequence.current !== version) return;
          const details = await Promise.all(
            window.rows.slice(start, start + 12).map(async (row) => {
              const full = await client.request({
                type: 'detail',
                requestId: requestId(),
                itemId: row.id,
              });
              if (full.type !== 'itemDetail')
                throw new Error('Overview detail rejected');
              return entry(full);
            }),
          );
          all.push(...details);
        }
      }
      if (sequence.current === version) setEntries(all);
    })()
      .catch(() => {
        if (sequence.current === version) setError(true);
      })
      .finally(() => {
        if (sequence.current === version) setLoading(false);
      });
    return () => {
      sequence.current++;
      refreshSequence.current++;
    };
  }, [client, accountKey, view.filter, view.sort, view.search]);
  useEffect(() => {
    if (!entriesRef.current.length) return;
    const version = ++refreshSequence.current;
    void (async () => {
      const next: Entry[] = [];
      const priorEntries = entriesRef.current;
      for (let start = 0; start < priorEntries.length; start += 12) {
        if (refreshSequence.current !== version) return null;
        const batch = await Promise.all(
          priorEntries.slice(start, start + 12).map(async (prior) => {
            const full = await client.request({
              type: 'detail',
              requestId: requestId(),
              itemId: prior.detail.item.id,
            });
            if (full.type !== 'itemDetail')
              throw new Error('Overview refresh rejected');
            return entry(full);
          }),
        );
        next.push(...batch);
      }
      return next;
    })()
      .then((next) => {
        if (next && refreshSequence.current === version) setEntries(next);
      })
      .catch(() => {
        if (refreshSequence.current === version) setError(true);
      });
  }, [client, revision]);
  function change(next: ReviewView, search = false) {
    setView(next);
    writer.change({ ...next, accountKey }, search);
  }
  async function decide(id: string, value: DecisionValue) {
    const current = entriesRef.current.find(
      (value) => value.detail.item.id === id,
    );
    if (
      !current ||
      current.decision !== 'undecided' ||
      command.current ||
      loading
    )
      return;
    command.current = true;
    setBusy(true);
    setError(false);
    try {
      const reply = await client.request({
        type: 'decide',
        requestId: requestId(),
        commandId: requestId(),
        itemIds: [id],
        value,
        expected: { [id]: current.decision },
      });
      if (reply.type !== 'committed')
        throw new Error('Overview decision rejected');
      setEntries((entries) =>
        entries.map((entry) =>
          entry.detail.item.id === id ? { ...entry, decision: value } : entry,
        ),
      );
      setNotice(t('review.markNotice', { count: reply.changed }));
    } catch {
      setError(true);
    } finally {
      command.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (command.current) return;
    command.current = true;
    setBusy(true);
    try {
      const reply = await client.request({
        type: 'undo',
        requestId: requestId(),
        commandId: requestId(),
      });
      if (reply.type !== 'committed') {
        setNotice(t('review.noHistory'));
        return;
      }
      setNotice(
        t('review.undoNotice', {
          count: reply.changed,
          skipped: reply.skipped ?? 0,
        }),
      );
    } catch {
      setError(true);
    } finally {
      command.current = false;
      setBusy(false);
    }
  }
  const decided = entries.filter(
    (entry) => entry.decision !== 'undecided',
  ).length;
  const render = (value: Entry, index: number, position?: CSSProperties) => {
    const { detail, decision, suggestions } = value;
    const id = detail.item.id;
    return (
      <li
        key={id}
        data-testid="feed-card"
        data-item-id={id}
        data-decided={decision !== 'undecided'}
        data-index={index}
        ref={useVirtual ? virtualizer.measureElement : undefined}
        className={`${styles.entry} ${position ? styles.positioned : ''}`}
        style={position}
        tabIndex={0}
        aria-label={t('feed.card', { index: index + 1, total: shown.length })}
        onFocus={() => setFocusIndex(index)}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.repeat ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            localStorage.getItem('sp-single-keys') === 'off'
          )
            return;
          const key = event.key.toLowerCase();
          const action = ({ j: 'delete', k: 'keep', l: 'later' } as const)[
            key as 'j'
          ];
          if (action) {
            event.preventDefault();
            void decide(id, action);
          }
          if (key === 'u') {
            event.preventDefault();
            void undo();
          }
        }}
      >
        <div className={social.card}>
          {decision !== 'undecided' && (
            <div className={styles.decision}>
              {t(decisionMessage[decision])}
            </div>
          )}
          {popular.has(id) && (
            <span className={styles.popular} data-testid="popular-badge">
              <Star size={16} aria-hidden="true" />
              {t('feed.popular', { count: detail.item.engagement.likes ?? 0 })}
            </span>
          )}
          <PostCard item={detail.item} zone={zone} />
          {suggestions.map((suggestion) => (
            <div className={social.suggestion} key={suggestion.assessmentId}>
              <div className={social.suggestionHeader}>
                <span className={social.chip} data-risk={suggestion.risk}>
                  {t(riskMessage[suggestion.risk] ?? 'review.riskNone')}
                </span>
                <strong>{t(categoryID(suggestion.category))}</strong>
              </div>
              <p>{suggestion.reason}</p>
              {suggestion.evidence && (
                <blockquote className={styles.quote} dir="auto">
                  {suggestion.evidence}
                </blockquote>
              )}
            </div>
          ))}
          <div className={social.decisions}>
            <button
              className={social.keep}
              disabled={busy || decision !== 'undecided'}
              onClick={() => {
                void decide(id, 'keep');
              }}
            >
              <Check size={20} aria-hidden="true" />
              {t('review.keep')}
              <kbd className={social.key}>K</kbd>
            </button>
            <button
              className={social.delete}
              aria-describedby="feed-delete-help"
              disabled={busy || decision !== 'undecided'}
              onClick={() => {
                void decide(id, 'delete');
              }}
            >
              <Trash2 size={20} aria-hidden="true" />
              {t('proto.delete')}
              <kbd className={social.key}>J</kbd>
            </button>
            <button
              className={social.quiet}
              disabled={busy || decision !== 'undecided'}
              onClick={() => {
                void decide(id, 'later');
              }}
            >
              <Pause size={20} aria-hidden="true" />
              {t('review.later')}
              <kbd className={social.key}>L</kbd>
            </button>
          </div>
        </div>
      </li>
    );
  };
  return (
    <section className={styles.overview} data-testid="review-overview">
      <div className={styles.sticky}>
        <div className={styles.toolbar}>
          <label>
            {t('review.account')}
            <select
              value={accountKey}
              onChange={(event) => {
                const key = event.target.value;
                writer.change({ ...view, accountKey: key });
                onAccount(key);
              }}
            >
              {summary?.accounts.map((account) => (
                <option value={account.key} key={account.key}>
                  @{account.handle ?? account.key}
                </option>
              ))}
            </select>
          </label>
          <ReviewModes
            mode="all"
            onChange={(mode) => {
              if (mode === 'single') onSingle();
            }}
          />
          <button
            className={social.primary}
            // As in the single-card view: a bulk preview waits until the
            // decision in flight has committed, or its revision goes stale.
            disabled={loading || busy || !accountKey}
            onClick={onBulk}
          >
            <Sparkles size={18} aria-hidden="true" />
            {t('bulk.markSuggested')}
          </button>
        </div>
        <div className={styles.count}>
          <strong data-testid="feed-count">
            {t('feed.progress', { count: decided, total: entries.length })}
          </strong>
          {threshold !== null && (
            <span>
              {t('feed.threshold', { count: threshold })} ·{' '}
              <strong data-testid="popular-waiting-count">
                {t('feed.waiting', { count: waiting.length })}
              </strong>
            </span>
          )}
        </div>
        <progress
          className={social.progress}
          aria-label={t('feed.title')}
          value={decided}
          max={Math.max(entries.length, 1)}
        />
        <div className={styles.toolbar}>
          {threshold !== null && (
            <label className={styles.popularFilter}>
              <input
                type="checkbox"
                checked={onlyPopular}
                onChange={(event) => {
                  setOnlyPopular(event.target.checked);
                  setFocusIndex(0);
                }}
              />
              {t('feed.onlyPopular')}
            </label>
          )}
          <label>
            {t('review.search')}
            <input
              type="search"
              value={view.search}
              maxLength={4096}
              onChange={(event) =>
                change({ ...view, search: event.target.value }, true)
              }
            />
          </label>
          <label>
            {t('review.sort')}
            <select
              value={view.sort[0]?.by ?? 'risk'}
              onChange={(event) =>
                change({
                  ...view,
                  sort:
                    event.target.value === 'risk'
                      ? OVERVIEW_SORT
                      : [
                          {
                            by: event.target.value as QuerySort[number]['by'],
                            direction: 'desc',
                          },
                          { by: 'id', direction: 'asc' },
                        ],
                })
              }
            >
              <option value="risk">{t('feed.riskLikes')}</option>
              <option value="likes">{t('review.likes')}</option>
              <option value="createdAt">{t('review.date')}</option>
              <option value="reposts">{t('feed.reposts')}</option>
            </select>
          </label>
          <button
            className={social.textButton}
            disabled={busy}
            onClick={() => {
              void undo();
            }}
          >
            <Undo2 size={16} aria-hidden="true" />
            {t('review.undo')}
            <kbd className={social.key}>U</kbd>
          </button>
        </div>
        <Filters
          filter={view.filter}
          template={template}
          zone={zone}
          onTemplate={setTemplate}
          onFilter={(filter) => change({ ...view, filter })}
        />
        <p className={social.hint}>
          {t('proto.cardKeysShort')}
          <span className={social.srOnly} id="feed-delete-help">
            {t('proto.deleteHelp')}
          </span>
        </p>
      </div>
      {(error || popularityError) && (
        <p role="alert" className={social.error}>
          {t('workspace.storageError')}
        </p>
      )}
      <p role="status" className={social.notice}>
        {loading ? t('gate.preparing') : (notice ?? t('feed.onlySuggestions'))}
      </p>
      <div ref={viewport} className={useVirtual ? styles.viewport : undefined}>
        <ul
          className={`${styles.feed} ${useVirtual ? styles.canvas : ''}`}
          style={
            useVirtual ? { height: virtualizer.getTotalSize() } : undefined
          }
        >
          {useVirtual
            ? virtualizer.getVirtualItems().map((row) =>
                render(shown[row.index]!, row.index, {
                  transform: `translateY(${row.start}px)`,
                }),
              )
            : shown.map((value, index) => render(value, index))}
        </ul>
      </div>
      {!loading && !shown.length && (
        <p className={social.empty}>{t('review.noResults')}</p>
      )}
    </section>
  );
}
