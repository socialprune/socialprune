import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowLeft, Bookmark, Check, Circle, Image, Pause } from 'lucide-react';
import { useIntl } from 'react-intl';
import { dayKey } from '@socialprune/core/workspace/time';
import type { AssessmentSource, DecisionValue } from '@socialprune/core';
import type {
  ItemDetail,
  QueryFilter,
  QuerySort,
  ReviewRow,
  WorkspaceReply,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import {
  categoryID,
  decisionMessage,
  evidenceParts,
  kindMessage,
  letterDecision,
  platformLink,
  riskMessage,
} from './model.ts';
import styles from './Review.module.css';

const WINDOW = 200;
const visibleIndex = (index: number) => Math.floor(index / WINDOW) * WINDOW;
const nextId = () => crypto.randomUUID();
const keys = [
  '↑ ↓',
  'Home / End',
  'Page Up / Page Down',
  'Space',
  'Shift+↑ / Shift+↓',
  'Enter',
  'Escape',
  'M / K / L / U',
  'Ctrl+Z / Cmd+Z',
  'Ctrl+Y / Cmd+Shift+Z',
  '?',
];

function Source({ source }: { source: AssessmentSource }) {
  const t = useT();
  return (
    <span className={styles.badge}>
      {source.kind === 'fixture'
        ? t('review.example')
        : source.kind === 'agent'
          ? t('review.agent', { name: source.name })
          : source.name}
    </span>
  );
}
function DecisionBadge({ value }: { value: DecisionValue }) {
  const t = useT();
  const Icon = {
    keep: Check,
    delete: Bookmark,
    later: Pause,
    undecided: Circle,
  }[value];
  return (
    <span className={value === 'delete' ? styles.marked : undefined}>
      <Icon size={20} aria-hidden="true" /> {t(decisionMessage[value])}
    </span>
  );
}

export function Review({ client }: { client: WorkspaceClient }) {
  const t = useT();
  const intl = useIntl();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(
    client.summary,
  );
  const [accountKey, setAccountKey] = useState(
    client.summary?.accounts[0]?.key ?? '',
  );
  const [filter, setFilter] = useState<QueryFilter>({});
  const [sort, setSort] = useState<QuerySort>([
    { by: 'createdAt', direction: 'desc' },
  ]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<readonly ReviewRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sourceBadges, setSourceBadges] = useState<
    Map<string, AssessmentSource[]>
  >(new Map());
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState(true);
  const [activeCommand, setActiveCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<
    Extract<WorkspaceReply, { type: 'historyEntries' }>['entries']
  >([]);
  const [paged, setPaged] = useState(false);
  const [singleKeys, setSingleKeys] = useState(
    () => localStorage.getItem('sp-single-keys') !== 'off',
  );
  const [tip, setTip] = useState(
    () => localStorage.getItem('sp-review-tip') !== 'off',
  );
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const queryId = useRef(nextId());
  const generation = useRef(0);
  const grid = useRef<HTMLDivElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const activeDetail = useRef<string | null>(null);
  const detailInvoker = useRef<HTMLElement | null>(null);
  const windowOffset = useRef(0);
  const loadingWindow = useRef<string | null>(null);
  const currentQuery = useRef({ generation: 0, total: 0 });
  const focusedIndex = useRef(0);
  const movingFocus = useRef(false);
  const pendingCommands = useRef(new Set<Promise<unknown>>());
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => grid.current,
    estimateSize: () => 180,
    overscan: 3,
  });
  const zone =
    summary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(
    () =>
      client.subscribe((notification) => {
        if (notification.type === 'changed') setRevision(notification.revision);
      }),
    [client],
  );
  useEffect(() => {
    if (!detailId) return;
    void client
      .request({ type: 'detail', requestId: nextId(), itemId: detailId })
      .then((reply) => {
        if (reply.type === 'itemDetail' && activeDetail.current === detailId)
          setDetail(reply);
      });
  }, [client, detailId, revision]);
  useEffect(() => {
    if (!historyOpen) return;
    void client
      .request({ type: 'history', requestId: nextId(), limit: 100 })
      .then((reply) => {
        if (reply.type === 'historyEntries') setHistory(reply.entries);
      });
  }, [client, historyOpen, revision]);
  useEffect(() => {
    let mounted = true;
    void client.open().then((reply) => {
      if (!mounted || reply.type !== 'opened') return;
      setSummary(reply.summary);
      setAccountKey(reply.summary.accounts[0]?.key ?? '');
      setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [client]);
  useEffect(
    () => () => {
      activeDetail.current = null;
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!accountKey || !loaded) return;
    let current = true;
    const next = ++generation.current;
    const timer = setTimeout(() => {
      if (current) setSearching(true);
    }, 150);
    void client
      .request({
        type: 'query',
        requestId: nextId(),
        queryId: queryId.current,
        generation: next,
        accountKey,
        filter,
        sort,
        search,
      })
      .then(async (result) => {
        if (!current || result.type !== 'queryResult') return;
        currentQuery.current = { generation: next, total: result.total };
        setTotal(result.total);
        const first = Math.min(
          focusedIndex.current,
          Math.max(0, result.total - 1),
        );
        // A late query reply must not overwrite a newer keyboard focus move.
        focusedIndex.current = first;
        setFocusIndex(first);
        await loadWindow(visibleIndex(first), next);
      })
      .catch(() => {
        if (current) setError(t('review.storageError'));
      })
      .finally(() => {
        clearTimeout(timer);
        if (current) setSearching(false);
      });
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, loaded, accountKey, filter, sort, search, revision]);

  async function loadWindow(
    start: number,
    version = currentQuery.current.generation,
  ) {
    const windowKey = `${version}:${start}`;
    if (!version || loadingWindow.current === windowKey) return;
    loadingWindow.current = windowKey;
    try {
      const reply = await client.request({
        type: 'window',
        requestId: nextId(),
        queryId: queryId.current,
        generation: version,
        offset: start,
        limit: WINDOW,
      });
      if (reply.type !== 'rows' || version !== generation.current) return;
      windowOffset.current = start;
      setOffset(start);
      setRows(reply.rows);
      // Bounded web metadata supplements the shared row protocol. Full item
      // text crosses the page boundary only for an explicitly opened detail.
      const badges = await client.sources(
        reply.rows
          .filter(({ highestRisk }) => highestRisk !== null)
          .map(({ id }) => id),
      );
      if (version === generation.current) setSourceBadges(badges);
    } catch {
      setError(t('review.storageError'));
    } finally {
      if (loadingWindow.current === windowKey) loadingWindow.current = null;
    }
  }
  function rowAt(index: number) {
    return rows[index - offset];
  }
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const first = virtualItems[0]?.index;
    if (first !== undefined) {
      if (visibleIndex(first) !== windowOffset.current)
        void loadWindow(visibleIndex(first));
      if (
        movingFocus.current &&
        virtualItems.some(({ index }) => index === focusedIndex.current)
      )
        movingFocus.current = false;
      if (
        !movingFocus.current &&
        !virtualItems.some(({ index }) => index === focusedIndex.current)
      ) {
        focusedIndex.current = first;
        setFocusIndex(first);
      }
    }
  }, [virtualItems[0]?.index]);

  async function move(index: number, extend = false) {
    movingFocus.current = true;
    const bounded = Math.min(Math.max(0, index), Math.max(0, total - 1));
    if (visibleIndex(bounded) !== windowOffset.current)
      await loadWindow(visibleIndex(bounded));
    setFocusIndex(bounded);
    focusedIndex.current = bounded;
    if (!paged) virtualizer.scrollToIndex(bounded, { align: 'auto' });
    if (extend) {
      const anchor = rowAt(focusIndex)?.id;
      const result = await client.request({
        type: 'window',
        requestId: nextId(),
        queryId: queryId.current,
        generation: generation.current,
        offset: bounded,
        limit: 1,
      });
      if (result.type === 'rows' && result.rows[0])
        setSelection(
          (prior) =>
            new Set([
              ...prior,
              ...(anchor ? [anchor] : []),
              result.rows[0]!.id,
            ]),
        );
    }
  }
  function toggle(id: string) {
    setSelection((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function openDetail(row: ReviewRow) {
    detailInvoker.current = document.activeElement as HTMLElement | null;
    activeDetail.current = row.id;
    setDetailId(row.id);
    setDetail(null);
    try {
      const reply = await client.request({
        type: 'detail',
        requestId: nextId(),
        itemId: row.id,
      });
      if (reply.type === 'itemDetail' && activeDetail.current === row.id) {
        setDetail(reply);
        requestAnimationFrame(() => {
          if (activeDetail.current === row.id) detailHeading.current?.focus();
        });
      } else setError(t('review.storageError'));
    } catch {
      setError(t('review.storageError'));
    }
  }
  function closeDetail() {
    activeDetail.current = null;
    setDetailId(null);
    setDetail(null);
    if (grid.current) grid.current.focus();
    else detailInvoker.current?.focus();
  }
  async function command(value: DecisionValue, explicit?: ReviewRow) {
    // W2a single-item proof. A selected group requires W2b's frozen preview,
    // never silently turn selection into a list of independent writes.
    if (!explicit && selection.size) {
      setNotice(t('review.bulkPending'));
      return;
    }
    const row = explicit ?? rowAt(focusIndex);
    if (!row || pendingCommands.current.size) return;
    const promise = client.request({
      type: 'decide',
      requestId: nextId(),
      commandId: nextId(),
      itemIds: [row.id],
      value,
      expected: { [row.id]: row.decision },
    });
    pendingCommands.current.add(promise);
    setSaved(false);
    setActiveCommand(true);
    try {
      const result = await promise;
      if (result.type !== 'committed') {
        setError(t('review.storageError'));
        return;
      }
      setSaved(true);
      setRows((prior) =>
        prior.map((item) =>
          item.id === row.id ? { ...item, decision: value } : item,
        ),
      );
      setNotice(t('review.markNotice', { count: result.changed }));
      setRevision(result.revision);
    } catch {
      setError(t('review.storageError'));
    } finally {
      pendingCommands.current.delete(promise);
      setActiveCommand(false);
    }
  }
  async function reverse(kind: 'undo' | 'redo') {
    if (pendingCommands.current.size) return;
    const promise = client.request({
      type: kind,
      requestId: nextId(),
      commandId: nextId(),
    });
    pendingCommands.current.add(promise);
    setSaved(false);
    setActiveCommand(true);
    try {
      const result = await promise;
      if (result.type === 'committed') {
        setSaved(true);
        setNotice(
          t('review.undoNotice', {
            count: result.changed,
            skipped: result.skipped ?? 0,
          }),
        );
        setRevision(result.revision);
      } else {
        setNotice(t('review.noHistory'));
        setSaved(true);
      }
    } catch {
      setError(t('review.storageError'));
    } finally {
      pendingCommands.current.delete(promise);
      setActiveCommand(false);
    }
  }
  async function showHistory() {
    const result = await client.request({
      type: 'history',
      requestId: nextId(),
      limit: 100,
    });
    if (result.type === 'historyEntries') {
      setHistory(result.entries);
      setHistoryOpen(true);
    }
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      event.preventDefault();
      void reverse(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (event.ctrlKey && key.toLowerCase() === 'y') {
      event.preventDefault();
      void reverse('redo');
      return;
    }
    const perScreen = Math.max(
      1,
      virtualItems.filter(
        (item) =>
          item.end >= virtualizer.scrollOffset! &&
          item.start <=
            virtualizer.scrollOffset! + (grid.current?.clientHeight ?? 0),
      ).length - 1,
    );
    const movement = {
      ArrowDown: focusIndex + 1,
      ArrowUp: focusIndex - 1,
      Home: 0,
      End: total - 1,
      PageDown: focusIndex + perScreen,
      PageUp: focusIndex - perScreen,
    }[key as 'Home'];
    if (movement !== undefined) {
      event.preventDefault();
      void move(movement, event.shiftKey);
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      const row = rowAt(focusIndex);
      if (row) toggle(row.id);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      const row = rowAt(focusIndex);
      if (row) void openDetail(row);
      return;
    }
    if (key === 'Escape' && detailId) {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (key === '?' && singleKeys) {
      event.preventDefault();
      setHelpOpen(true);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const value = letterDecision(key, true, singleKeys);
    if (value) {
      event.preventDefault();
      void command(value);
    }
  }
  async function changeView() {
    await Promise.all(pendingCommands.current);
    setPaged((value) => !value);
    setSelection(new Set());
    closeDetail();
  }
  function rowContent(row: ReviewRow) {
    return (
      <>
        <div className={styles.metadata}>
          <time dateTime={row.createdAt}>
            {intl.formatDate(row.createdAt, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              timeZone: zone,
            })}
          </time>
          <span>{t(kindMessage[row.kind])}</span>
        </div>
        <p className={styles.rowText}>
          {row.text ||
            (row.mediaCount ? t('review.mediaOnly') : t('review.noText'))}
        </p>
        {row.mediaCount !== null && row.mediaCount > 0 && (
          <p>
            <Image size={20} aria-hidden="true" />{' '}
            {t('review.mediaCount', { count: row.mediaCount })}
          </p>
        )}
        {row.highestRisk !== null && (
          <div className={styles.badge}>
            {t(riskMessage[row.highestRisk] ?? 'review.riskNone')}{' '}
            {row.categories
              .map((category) => t(categoryID(category)))
              .join(', ')}
          </div>
        )}
        {(sourceBadges.get(row.id) ?? []).map((source, index) => (
          <Source key={index} source={source} />
        ))}
        <DecisionBadge value={row.decision} />
      </>
    );
  }
  function historyValue(value: string) {
    return Object.hasOwn(decisionMessage, value)
      ? t(decisionMessage[value as DecisionValue])
      : t('review.outcomeRecorded');
  }
  const focused = rowAt(focusIndex);
  return (
    <section
      aria-label={t('review.title')}
      data-testid="review"
      data-generation={generation.current}
    >
      {summary?.kind === 'demo' && (
        <p className={styles.notice}>{t('demo.banner')}</p>
      )}
      <div className={styles.review}>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            {t('review.account')}
            <select
              value={accountKey}
              onChange={(event) => {
                setAccountKey(event.target.value);
                setSelection(new Set());
                setRows([]);
                client.rows = [];
                setSourceBadges(new Map());
                closeDetail();
              }}
            >
              {summary?.accounts.map((account) => (
                <option key={account.key} value={account.key}>
                  {account.handle ?? account.key}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t('review.search')}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            {t('review.status')}
            <select
              onChange={(event) =>
                setFilter(
                  event.target.value === 'all'
                    ? {}
                    : { decisions: [event.target.value as DecisionValue] },
                )
              }
            >
              <option value="all">{t('review.all')}</option>
              {(['undecided', 'keep', 'later', 'delete'] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {t(decisionMessage[value])}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className={styles.field}>
            {t('review.sort')}
            <select
              value={sort[0]?.by}
              onChange={(event) =>
                setSort([
                  {
                    by: event.target.value as QuerySort[0]['by'],
                    direction: 'desc',
                  },
                ])
              }
            >
              <option value="createdAt">{t('review.date')}</option>
              <option value="risk">{t('review.risk')}</option>
              <option value="likes">{t('review.likes')}</option>
            </select>
          </label>
          <button
            onClick={() => {
              void changeView();
            }}
          >
            {paged ? t('review.virtualList') : t('review.pagedList')}
          </button>
          <button onClick={() => setHelpOpen(true)}>
            {t('review.keyboard')}
          </button>
          <button
            onClick={() => {
              void showHistory();
            }}
          >
            {t('review.history')}
          </button>
          <span role="status">
            {saved ? t('review.saved') : t('review.saving')}
          </span>
        </div>
        <div className={styles.listRegion}>
          {tip && (
            <p>
              {t('review.tip')}{' '}
              <button
                onClick={() => {
                  setTip(false);
                  localStorage.setItem('sp-review-tip', 'off');
                }}
              >
                {t('review.dismiss')}
              </button>
            </p>
          )}
          <p aria-live="polite">
            {searching
              ? t('review.searching')
              : t('review.total', { count: total })}
          </p>
          <p>
            {t('review.selected', { count: selection.size })}{' '}
            <button
              onClick={() => setSelection(new Set(rows.map(({ id }) => id)))}
            >
              {t('review.selectWindow')}
            </button>{' '}
            <button onClick={() => setSelection(new Set())}>
              {t('review.clearSelection')}
            </button>
          </p>
          {paged ? (
            <>
              <ul className={styles.nativeList}>
                {rows.map((row) => (
                  <li className={styles.nativeRow} key={row.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selection.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />{' '}
                      {t('review.selectEntry')}
                    </label>
                    {rowContent(row)}
                    <button
                      onClick={() => {
                        void openDetail(row);
                      }}
                    >
                      {t('review.openDetail')}
                    </button>
                  </li>
                ))}
              </ul>
              <div className={styles.actions}>
                <button
                  disabled={!offset}
                  onClick={() => {
                    void loadWindow(Math.max(0, offset - WINDOW));
                  }}
                >
                  {t('review.previous')}
                </button>
                <button
                  disabled={offset + WINDOW >= total}
                  onClick={() => {
                    void loadWindow(offset + WINDOW);
                  }}
                >
                  {t('review.next')}
                </button>
              </div>
            </>
          ) : (
            <div
              role="grid"
              aria-label={t('review.entries')}
              aria-colcount={1}
              aria-rowcount={total}
              aria-activedescendant={
                focused &&
                virtualItems.some(({ index }) => index === focusIndex)
                  ? `review-cell-${focusIndex}`
                  : undefined
              }
              aria-describedby="review-key-tip"
              tabIndex={0}
              ref={grid}
              className={styles.grid}
              onKeyDown={keyboard}
            >
              <div
                className={styles.canvas}
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualItems.map((virtual) => {
                  const row = rowAt(virtual.index);
                  const previous = rowAt(virtual.index - 1);
                  return row ? (
                    <div
                      role="row"
                      aria-rowindex={virtual.index + 1}
                      aria-selected={selection.has(row.id)}
                      key={row.id}
                      data-index={virtual.index}
                      ref={virtualizer.measureElement}
                      className={`${styles.row} ${focusIndex === virtual.index ? styles.focused : ''} ${selection.has(row.id) ? styles.selected : ''}`}
                      style={{ transform: `translateY(${virtual.start}px)` }}
                      onClick={() => {
                        focusedIndex.current = virtual.index;
                        setFocusIndex(virtual.index);
                        grid.current?.focus();
                      }}
                    >
                      <div role="gridcell" id={`review-cell-${virtual.index}`}>
                        {(!previous ||
                          dayKey(previous.createdAt, zone) !==
                            dayKey(row.createdAt, zone)) && (
                          <strong>
                            {intl.formatDate(row.createdAt, {
                              dateStyle: 'long',
                              timeZone: zone,
                            })}
                          </strong>
                        )}
                        {rowContent(row)}
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
          <p id="review-key-tip">{t('review.gridHelp')}</p>
          {notice && (
            <div role="status" className={styles.notice}>
              <span>{notice}</span>{' '}
              <button
                onClick={() => {
                  void reverse('undo');
                }}
              >
                {t('review.undo')}
              </button>
              <button
                onClick={() => {
                  void reverse('redo');
                }}
              >
                {t('review.redo')}
              </button>
            </div>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button
                onClick={() => {
                  void client.downloadBackup();
                }}
              >
                {t('workspace.backup')}
              </button>
            </div>
          )}
        </div>
        {detailId && (
          <section
            aria-label={t('review.detail')}
            className={styles.detail}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeDetail();
              }
            }}
          >
            <button onClick={closeDetail}>
              <ArrowLeft size={20} aria-hidden="true" /> {t('review.back')}
            </button>
            <h2 ref={detailHeading} tabIndex={-1}>
              {t('review.detail')}
            </h2>
            {detail && (
              <>
                <p className={styles.fullText}>{detail.item.text}</p>
                <p>
                  {t('review.likesValue', {
                    count: detail.item.engagement.likes ?? -1,
                  })}
                </p>
                <p>{t('review.exportEngagement')}</p>
                {detail.item.mediaCount !== null &&
                  detail.item.mediaCount > 0 && (
                    <p>
                      {t('review.mediaDetail', {
                        count: detail.item.mediaCount,
                      })}
                    </p>
                  )}
                {detail.item.platform === 'x' &&
                  platformLink(detail.item.url) && (
                    <a
                      href={platformLink(detail.item.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('review.openX')}
                    </a>
                  )}
                {detail.assessments.length ? (
                  <div>
                    {detail.assessments.map((assessment) => {
                      const evidence = evidenceParts(
                        detail.item.text,
                        assessment.evidence,
                      );
                      return (
                        <section key={assessment.assessmentId}>
                          <h3>
                            {t(categoryID(assessment.category))} ·{' '}
                            {t(
                              riskMessage[assessment.risk] ?? 'review.riskNone',
                            )}
                          </h3>
                          <Source source={assessment.source} />
                          <p>{assessment.reason}</p>
                          {evidence && (
                            <blockquote>
                              {evidence.before}
                              <mark className={styles.evidence}>
                                {evidence.match}
                              </mark>
                              {evidence.after}
                            </blockquote>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <p>{t('review.noSuggestions')}</p>
                )}
                <div className={styles.actions}>
                  {(['keep', 'delete', 'later', 'undecided'] as const).map(
                    (value) => (
                      <button
                        key={value}
                        disabled={activeCommand}
                        onClick={() => {
                          const row = rows.find(
                            ({ id }) => id === detail.item.id,
                          );
                          if (row) void command(value, row);
                        }}
                      >
                        {t(decisionMessage[value])}{' '}
                        <kbd>
                          {
                            {
                              keep: 'K',
                              delete: 'M',
                              later: 'L',
                              undecided: 'U',
                            }[value]
                          }
                        </kbd>
                      </button>
                    ),
                  )}
                </div>
                <h3>{t('review.itemHistory')}</h3>
                <ol>
                  {detail.events.map((event) => (
                    <li key={event.eventId}>
                      {'decidedAt' in event
                        ? t(decisionMessage[event.value])
                        : t('review.outcomeRecorded')}{' '}
                      {intl.formatDate(
                        'decidedAt' in event
                          ? event.decidedAt
                          : event.recordedAt,
                        {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: zone,
                        },
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        )}
      </div>
      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.dialog}>
            <Dialog.Title>{t('review.keyboard')}</Dialog.Title>
            <Dialog.Description>{t('review.keyboardIntro')}</Dialog.Description>
            <table>
              <caption>{t('review.keyboard')}</caption>
              <tbody>
                {keys.map((key, index) => (
                  <tr key={key}>
                    <th scope="row">
                      <kbd>{key}</kbd>
                    </th>
                    <td>
                      {t(
                        (
                          [
                            'review.keyMove',
                            'review.keyEnds',
                            'review.keyPage',
                            'review.keySelect',
                            'review.keyExtend',
                            'review.keyOpen',
                            'review.keyClose',
                            'review.keyDecide',
                            'review.keyUndo',
                            'review.keyRedo',
                            'review.keyHelp',
                          ] as const
                        )[index]!,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {t('review.keySetting', {
                state: singleKeys ? t('review.on') : t('review.off'),
              })}
            </p>
            <button
              onClick={() => {
                setSingleKeys((value) => !value);
                localStorage.setItem(
                  'sp-single-keys',
                  singleKeys ? 'off' : 'on',
                );
              }}
            >
              {t('review.toggleKeys')}
            </button>
            <Dialog.Close>{t('review.close')}</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.dialog}>
            <Dialog.Title>{t('review.history')}</Dialog.Title>
            <Dialog.Description>{t('review.historyIntro')}</Dialog.Description>
            <ol className={styles.history}>
              {history.map((entry) => (
                <li key={entry.actionId}>
                  {intl.formatDate(entry.time, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: zone,
                  })}
                  :{' '}
                  {t('review.historyEntry', {
                    count: entry.size,
                    value: historyValue(entry.value),
                  })}
                </li>
              ))}
            </ol>
            <button
              onClick={() => {
                void reverse('undo');
              }}
            >
              {t('review.undo')}
            </button>
            <button
              onClick={() => {
                void reverse('redo');
              }}
            >
              {t('review.redo')}
            </button>
            <Dialog.Close>{t('review.close')}</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
