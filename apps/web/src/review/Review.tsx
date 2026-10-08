import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Dialog } from '@base-ui/react/dialog';
import { ContextMenu } from '@base-ui/react/context-menu';
import { ArrowLeft, Bookmark, Check, Circle, Image, Pause } from 'lucide-react';
import { useIntl } from 'react-intl';
import { dayKey } from '@socialprune/core/workspace/time';
import type { AssessmentSource, DecisionValue } from '@socialprune/core';
import type {
  ItemDetail,
  BulkPreview,
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
  actionMessage,
  decisionMessage,
  evidenceSegments,
  kindMessage,
  letterDecision,
  platformLink,
  riskMessage,
} from './model.ts';
import styles from './Review.module.css';
import { BulkDialog } from './BulkDialog.tsx';
import { templateMessage } from './filters.ts';
import type { Template } from './filters.ts';
import { Filters } from './Filters.tsx';
import { initialReviewView, ReviewViewWriter } from './view.ts';
import type { ReviewView } from '@socialprune/core';

const WINDOW = 200;
const PAGE = 100;
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
          : source.kind === 'model'
            ? t('review.modelSource', { name: source.name })
            : t('review.sourceRules')}
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
  const [view, setView] = useState(() =>
    initialReviewView(client.summary, (value) => client.parseReviewView(value)),
  );
  const { filter, sort, search } = view;
  const accountKey = view.accountKey ?? '';
  const viewChanged = useRef(false);
  const viewRef = useRef(view);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<readonly ReviewRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState(true);
  const [template, setTemplate] = useState<Template>('none');
  const [queryCounts, setQueryCounts] = useState<
    Extract<WorkspaceReply, { type: 'queryResult' }>['counts'] | null
  >(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [bulkValue, setBulkValue] = useState<DecisionValue>('delete');
  const [bulkOverwrite, setBulkOverwrite] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkReplacement, setBulkReplacement] = useState<
    'stale' | 'expired' | null
  >(null);
  const [activeCommand, setActiveCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewWriter] = useState(
    () =>
      new ReviewViewWriter((review) => {
        void client
          .request({ type: 'setReviewView', requestId: nextId(), view: review })
          .then((reply) => {
            if (reply.type !== 'reviewViewChanged')
              setError(t('review.storageError'));
          })
          .catch(() => setError(t('review.storageError')));
      }),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const pageId = useRef(nextId());
  const previewId = useRef<string | null>(null);
  const bulkVersion = useRef(0);
  const bulkQueryId = useRef(nextId());
  const bulkGeneration = useRef(0);
  const bulkSelected = useRef<string[] | null>(null);
  const bulkFilter = useRef<QueryFilter | null>(null);
  const [bulkSuggested, setBulkSuggested] = useState(false);
  const allViewSelected = useRef(false);
  const [selectionAll, setSelectionAll] = useState(false);
  const generation = useRef(0);
  const grid = useRef<HTMLDivElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const activeDetail = useRef<string | null>(null);
  const detailInvoker = useRef<HTMLElement | null>(null);
  const windowOffset = useRef(0);
  const loadingWindow = useRef<string | null>(null);
  const windowRequest = useRef<string | null>(null);
  const selectionAnchor = useRef<number | null>(null);
  const currentQuery = useRef({ generation: 0, total: 0 });
  const focusedIndex = useRef(0);
  const movingFocus = useRef(false);
  const pendingCommands = useRef(new Set<Promise<unknown>>());
  const ownRevision = useRef(-1);
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => grid.current,
    estimateSize: () => 180,
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
    getItemKey: (index) => rows[index - offset]?.id ?? `loading-${index}`,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), focusIndex])]
        .filter((index) => index >= 0 && index < total)
        .sort((a, b) => a - b),
  });
  const zone =
    summary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(
    () =>
      client.subscribe((notification) => {
        if (notification.type === 'changed') {
          setRevision(notification.revision);
          if (
            !pendingCommands.current.size &&
            notification.revision !== ownRevision.current
          )
            setNotice(t('review.otherTab'));
        }
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
      })
      .catch(() => setError(t('review.storageError')));
  }, [client, detailId, revision]);
  useEffect(() => {
    if (!historyOpen) return;
    void client
      .request({ type: 'history', requestId: nextId(), limit: 50 })
      .then((reply) => {
        if (reply.type === 'historyEntries') setHistory(reply.entries);
      })
      .catch(() => setError(t('review.storageError')));
  }, [client, historyOpen, revision]);
  useEffect(() => {
    let mounted = true;
    void client
      .open()
      .then((reply) => {
        if (!mounted) return;
        if (reply.type !== 'opened') {
          setError(t('review.storageError'));
          return;
        }
        setSummary(reply.summary);
        // Preserve a person's account choice made while the initial store read
        // was pending; a late summary must not move the view to another account.
        if (!viewChanged.current) {
          const restored = initialReviewView(reply.summary, (value) =>
            client.parseReviewView(value),
          );
          viewRef.current = restored;
          setView(restored);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) setError(t('review.storageError'));
      });
    return () => {
      mounted = false;
    };
  }, [client]);
  useEffect(
    () => () => {
      viewWriter.flush();
      activeDetail.current = null;
      generation.current++;
      bulkVersion.current++;
      if (previewId.current)
        void client
          .request({
            type: 'releasePreview',
            requestId: nextId(),
            pageId: pageId.current,
            previewId: previewId.current,
          })
          .catch(() => undefined);
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
        setQueryCounts(result.counts);
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
    forRange = false,
  ) {
    const windowKey = `${version}:${start}`;
    if (!version || loadingWindow.current === windowKey) return;
    loadingWindow.current = windowKey;
    const requestId = nextId();
    windowRequest.current = requestId;
    try {
      const reply = await client.request({
        type: 'window',
        requestId,
        queryId: queryId.current,
        generation: version,
        offset: start,
        limit: paged ? PAGE : WINDOW,
      });
      if (
        reply.type !== 'rows' ||
        version !== generation.current ||
        windowRequest.current !== requestId
      )
        return;
      // A scroll event can request the old range while a keyboard scroll is
      // still settling. Its reply must not evict the newly focused window.
      if (
        forRange &&
        visibleIndex(virtualizer.range?.startIndex ?? 0) !== start
      )
        return;
      windowOffset.current = start;
      setOffset(start);
      setRows(reply.rows);
    } catch {
      setError(t('review.storageError'));
    } finally {
      if (windowRequest.current === requestId) {
        loadingWindow.current = null;
        windowRequest.current = null;
      }
    }
  }
  function rowAt(index: number) {
    return rows[index - offset];
  }
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const first = virtualizer.range?.startIndex;
    if (first !== undefined) {
      if (visibleIndex(first) !== windowOffset.current) {
        void loadWindow(visibleIndex(first), undefined, true);
        if (!movingFocus.current) {
          focusedIndex.current = first;
          setFocusIndex(first);
        }
      }
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
  }, [virtualizer.range?.startIndex]);

  async function move(index: number, extend = false) {
    movingFocus.current = true;
    const bounded = Math.min(Math.max(0, index), Math.max(0, total - 1));
    if (visibleIndex(bounded) !== windowOffset.current)
      await loadWindow(visibleIndex(bounded));
    else {
      // Home can use cached rows without sending a newer request. It still
      // supersedes an outstanding scroll-driven request for another window.
      loadingWindow.current = null;
      windowRequest.current = null;
    }
    setFocusIndex(bounded);
    focusedIndex.current = bounded;
    if (!paged) virtualizer.scrollToIndex(bounded, { align: 'auto' });
    if (extend) {
      allViewSelected.current = false;
      setSelectionAll(false);
      const anchor = selectionAnchor.current ?? focusIndex;
      selectionAnchor.current = anchor;
      const start = Math.min(anchor, bounded),
        end = Math.max(anchor, bounded);
      if (end - start + 1 > 10_000) {
        setNotice(t('bulk.selectionLimit'));
        return;
      }
      const selected = new Set(selection);
      for (let offset = start; offset <= end; offset += WINDOW) {
        const result = await client.request({
          type: 'window',
          requestId: nextId(),
          queryId: queryId.current,
          generation: generation.current,
          offset,
          limit: Math.min(WINDOW, end - offset + 1),
        });
        if (result.type === 'rows')
          for (const row of result.rows) selected.add(row.id);
      }
      setSelection(selected);
      client.rows = rows;
    } else selectionAnchor.current = null;
  }
  function toggle(id: string) {
    allViewSelected.current = false;
    setSelectionAll(false);
    setSelection((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function resetView() {
    generation.current++;
    setSelection(new Set());
    selectionAnchor.current = null;
    allViewSelected.current = false;
    setSelectionAll(false);
    setRows([]);
    client.rows = [];
    setFocusIndex(0);
    focusedIndex.current = 0;
    setOffset(0);
    windowOffset.current = 0;
    virtualizer.scrollToOffset(0);
    closeDetail(false);
    cancelBulk();
  }
  function updateFilter(value: QueryFilter) {
    resetView();
    updateReviewView({ filter: value });
    setError(null);
  }
  function updateReviewView(
    changes: Partial<ReviewView>,
    debounceSearch = false,
  ) {
    viewChanged.current = true;
    const next = { ...viewRef.current, ...changes };
    viewRef.current = next;
    setView(next);
    viewWriter.change(next, debounceSearch);
  }
  function cancelBulk() {
    bulkVersion.current++;
    if (previewId.current)
      void client
        .request({
          type: 'releasePreview',
          requestId: nextId(),
          pageId: pageId.current,
          previewId: previewId.current,
        })
        .catch(() => undefined);
    previewId.current = null;
    setBulkOpen(false);
    setBulkPreview(null);
    setBulkLoading(false);
    setBulkReplacement(null);
  }
  async function prepareBulk(
    value: DecisionValue,
    overwrite = bulkOverwrite,
    replacement: 'stale' | 'expired' | null = null,
    selectedIds: string[] | null = null,
    suggested = false,
  ) {
    if (!generation.current || pendingCommands.current.size) return;
    if (replacement === null) {
      bulkSelected.current = selectedIds;
      bulkFilter.current = suggested
        ? {
            ...filter,
            risk: { min: 2, max: 3, unknown: 'exclude' },
            decisions: ['undecided', 'later'],
          }
        : null;
      setBulkSuggested(suggested);
    }
    const version = ++bulkVersion.current;
    setBulkValue(value);
    setBulkOverwrite(overwrite);
    setBulkOpen(true);
    setBulkLoading(true);
    setBulkReplacement(replacement);
    const id = nextId();
    try {
      if (previewId.current)
        await client.request({
          type: 'releasePreview',
          requestId: nextId(),
          pageId: pageId.current,
          previewId: previewId.current,
        });
      if (version !== bulkVersion.current) return;
      previewId.current = id;
      const queryGeneration = ++bulkGeneration.current;
      const fresh = await client.request({
        type: 'query',
        requestId: nextId(),
        queryId: bulkQueryId.current,
        generation: queryGeneration,
        accountKey,
        filter: bulkFilter.current ?? filter,
        sort,
        search,
      });
      if (version !== bulkVersion.current) return;
      if (fresh.type !== 'queryResult') {
        setError(t('review.storageError'));
        return;
      }
      const reply = await client.request({
        type: 'previewBulk',
        requestId: nextId(),
        pageId: pageId.current,
        previewId: id,
        queryId: bulkQueryId.current,
        generation: queryGeneration,
        value,
        overwrite: overwrite
          ? ['undecided', 'later', 'keep', 'delete']
          : ['undecided', 'later'],
        ...(bulkSelected.current ? { itemIds: bulkSelected.current } : {}),
      });
      if (version !== bulkVersion.current) {
        await client.request({
          type: 'releasePreview',
          requestId: nextId(),
          pageId: pageId.current,
          previewId: id,
        });
        return;
      }
      if (reply.type === 'bulkPreview') setBulkPreview(reply);
      else setError(t('review.storageError'));
    } catch {
      setError(t('review.storageError'));
    } finally {
      if (version === bulkVersion.current) setBulkLoading(false);
    }
  }
  async function confirmBulk() {
    if (!bulkPreview || bulkLoading) return;
    setBulkLoading(true);
    setError(null);
    setSaved(false);
    setActiveCommand(true);
    const promise = client.request({
      type: 'confirmBulk',
      requestId: nextId(),
      commandId: nextId(),
      pageId: pageId.current,
      previewId: bulkPreview.previewId,
    });
    pendingCommands.current.add(promise);
    try {
      const result = await promise;
      if (result.type === 'committed') {
        ownRevision.current = result.revision;
        setSaved(true);
        setNotice(t('review.markNotice', { count: result.changed }));
        setRevision(result.revision);
        cancelBulk();
        setSelection(new Set());
        allViewSelected.current = false;
        setSelectionAll(false);
      } else if (
        result.type === 'rejected' &&
        (result.code === 'STALE_PREVIEW' || result.code === 'PREVIEW_EXPIRED')
      ) {
        pendingCommands.current.delete(promise);
        await prepareBulk(
          bulkValue,
          bulkOverwrite,
          result.code === 'STALE_PREVIEW' ? 'stale' : 'expired',
        );
        setSaved(true);
      } else setError(t('review.storageError'));
    } catch {
      setError(t('review.storageError'));
    } finally {
      pendingCommands.current.delete(promise);
      setActiveCommand(false);
      setBulkLoading(false);
    }
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
  function closeDetail(returnFocus = true) {
    activeDetail.current = null;
    setDetailId(null);
    setDetail(null);
    if (!returnFocus) return;
    if (grid.current) grid.current.focus();
    else detailInvoker.current?.focus();
    requestAnimationFrame(() => {
      if (activeDetail.current === null) {
        if (grid.current) grid.current.focus();
        else detailInvoker.current?.focus();
      }
    });
  }
  async function command(value: DecisionValue, explicit?: ReviewRow) {
    if (!explicit && (selection.size || allViewSelected.current)) {
      if (!allViewSelected.current && selection.size > 10_000) {
        setNotice(t('bulk.selectionLimit'));
        return;
      }
      await prepareBulk(
        value,
        false,
        null,
        allViewSelected.current ? null : [...selection],
      );
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
    setError(null);
    setSaved(false);
    setActiveCommand(true);
    try {
      const result = await promise;
      if (result.type !== 'committed') {
        setError(t('review.storageError'));
        return;
      }
      setSaved(true);
      ownRevision.current = result.revision;
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
    setError(null);
    setSaved(false);
    setActiveCommand(true);
    try {
      const result = await promise;
      if (result.type === 'committed') {
        ownRevision.current = result.revision;
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
      limit: 50,
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
    if (key === 'ContextMenu' || (event.shiftKey && key === 'F10')) {
      event.preventDefault();
      const node = document.getElementById(
        `review-cell-${focusIndex}`,
      )?.parentElement;
      if (node) {
        const bounds = node.getBoundingClientRect();
        grid.current?.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            clientX: bounds.left + 12,
            clientY: bounds.top + 12,
            button: 2,
          }),
        );
      }
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
    allViewSelected.current = false;
    setSelectionAll(false);
    closeDetail();
    setRows([]);
    client.rows = [];
    windowOffset.current = 0;
    setOffset(0);
    setRevision((value) => value + 1);
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
            (row.mediaCount !== null && row.mediaCount > 0
              ? t('review.mediaOnly')
              : t('review.noText'))}
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
        {row.sources.map((source, index) => (
          <Source key={index} source={source} />
        ))}
        {row.moreSources > 0 && (
          <span
            className={styles.badge}
            aria-label={t('review.moreSources', { count: row.moreSources })}
          >
            +{row.moreSources}
          </span>
        )}
        <DecisionBadge value={row.decision} />
      </>
    );
  }
  function historyValue(value: string) {
    return Object.hasOwn(decisionMessage, value)
      ? t(decisionMessage[value as DecisionValue])
      : t('review.outcomeRecorded');
  }
  function historyKind(kind: string) {
    return t(
      kind === 'undo'
        ? 'review.historyUndo'
        : kind === 'redo'
          ? 'review.historyRedo'
          : kind === 'outcome'
            ? 'review.historyOutcome'
            : 'review.historyDecision',
    );
  }
  const focused = rowAt(focusIndex);
  const currentAssessments = detail
    ? [
        ...new Map(
          detail.assessments.map((assessment) => [
            JSON.stringify([assessment.source.kind, assessment.source.name]),
            assessment,
          ]),
        ).values(),
      ].sort(
        (a, b) => b.risk - a.risk || a.source.name.localeCompare(b.source.name),
      )
    : [];
  const unknownEngagement = {
    include: 'review.includeUnknown',
    exclude: 'review.excludeUnknown',
    only: 'review.onlyUnknown',
  } as const;
  const filterLabels =
    [
      search ? `${t('review.search')}: ${search}` : null,
      filter.decisions?.length
        ? `${t('review.status')}: ${filter.decisions.map((value) => t(decisionMessage[value])).join(', ')}`
        : null,
      filter.kinds?.length
        ? `${t('review.kindFilter')}: ${filter.kinds.map((value) => t(kindMessage[value])).join(', ')}`
        : null,
      filter.categories?.length
        ? `${t('review.categoryFilter')}: ${filter.categories.map((value) => t(categoryID(value))).join(', ')}`
        : null,
      filter.risk
        ? `${t('review.riskFilter')}: ${filter.risk.unknown === 'only' ? t('review.noSuggestionsFilter') : t(riskMessage[filter.risk.min ?? 0] ?? 'review.riskNone')}`
        : null,
      filter.dates
        ? `${t('review.dateFrom')}: ${filter.dates.from ?? ''}, ${t('review.dateTo')}: ${filter.dates.to ?? ''}`
        : null,
      filter.likes
        ? `${t('review.likesMinimum')}: ${filter.likes.min ?? ''}, ${t('review.likesMaximum')}: ${filter.likes.max ?? ''}, ${t('review.unknownEngagement')}: ${t(unknownEngagement[filter.likes.unknown])}`
        : null,
      filter.reposts
        ? `${t('review.repostsMinimum')}: ${filter.reposts.min ?? ''}, ${t('review.repostsMaximum')}: ${filter.reposts.max ?? ''}, ${t('review.unknownReposts')}: ${t(unknownEngagement[filter.reposts.unknown])}`
        : null,
      filter.sources?.length
        ? `${t('review.sourceFilter')}: ${filter.sources.map((source) => t(({ rules: 'review.sourceRules', model: 'review.sourceModel', agent: 'review.sourceAgent', fixture: 'review.example' } as const)[source])).join(', ')}`
        : null,
      filter.outcomes?.length
        ? `${t('review.outcomeFilter')}: ${filter.outcomes.map((outcome) => t(({ unknown: 'review.outcomeUnknown', skipped: 'review.outcomeSkipped', 'deleted-by-user': 'review.outcomeDeleted' } as const)[outcome])).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('; ') || t(templateMessage[template]);
  return (
    <section
      aria-label={t('review.title')}
      data-testid="review"
      className={styles.container}
      data-generation={generation.current}
      data-detail-open={detailId !== null}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            'input, textarea, select, [contenteditable="true"], [role="grid"]',
          )
        )
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z'
        ) {
          event.preventDefault();
          event.stopPropagation();
          void reverse(event.shiftKey ? 'redo' : 'undo');
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          event.stopPropagation();
          void reverse('redo');
        }
      }}
    >
      <div className={styles.review}>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            {t('review.account')}
            <select
              value={accountKey}
              onChange={(event) => {
                resetView();
                updateReviewView({
                  search: '',
                  filter: {},
                  accountKey: event.target.value,
                });
                setTemplate('none');
                setSelection(new Set());
                setRows([]);
                client.rows = [];
                closeDetail(false);
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
              maxLength={4096}
              value={search}
              onChange={(event) => {
                resetView();
                updateReviewView({ search: event.target.value }, true);
              }}
            />
          </label>
          <label className={styles.field}>
            {t('review.status')}
            <select
              value={filter.decisions?.[0] ?? 'all'}
              onChange={(event) =>
                updateFilter(
                  event.target.value === 'all'
                    ? { ...filter, decisions: undefined }
                    : {
                        ...filter,
                        decisions: [event.target.value as DecisionValue],
                      },
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
              onChange={(event) => {
                resetView();
                updateReviewView({
                  sort: [
                    {
                      by: event.target.value as QuerySort[0]['by'],
                      direction: 'desc',
                    },
                  ],
                });
              }}
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
          <span data-testid="save-state">
            {error && !saved
              ? t('review.notSaved')
              : saved
                ? t('review.saved')
                : t('review.saving')}
          </span>
        </div>
        <div className={styles.listRegion}>
          <Filters
            filter={filter}
            template={template}
            zone={zone}
            onFilter={updateFilter}
            onTemplate={setTemplate}
          />
          <div className={styles.actions} aria-label={t('bulk.actions')}>
            {summary && summary.counts.assessments > 0 && (
              <button
                disabled={activeCommand || searching}
                onClick={() => {
                  void prepareBulk('delete', false, null, null, true);
                }}
              >
                {t('bulk.markSuggested')}
              </button>
            )}
            {(['delete', 'keep', 'later', 'undecided'] as const).map(
              (value) => (
                <button
                  key={value}
                  disabled={activeCommand || searching || !total}
                  onClick={() => {
                    void prepareBulk(value, false);
                  }}
                >
                  {t('bulk.allAction', { action: t(actionMessage[value]) })}
                </button>
              ),
            )}
          </div>
          {(search ||
            Object.values(filter).some((value) => value !== undefined)) && (
            <p>
              {t('review.filtersActive')}{' '}
              <button
                onClick={() => {
                  resetView();
                  updateReviewView({ search: '', filter: {} });
                  setTemplate('none');
                }}
              >
                {t('review.clearFilters')}
              </button>
            </p>
          )}
          {!total && loaded && !searching && <p>{t('review.noResults')}</p>}
          {!!total &&
            !search &&
            !Object.values(filter).some((value) => value !== undefined) &&
            queryCounts?.decisions.undecided === 0 && (
              <p>{t('review.allDecided')}</p>
            )}
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
            {t('review.selected', {
              count: selectionAll ? total : selection.size,
            })}{' '}
            <button
              onClick={() => {
                allViewSelected.current = false;
                setSelectionAll(false);
                selectionAnchor.current = null;
                setSelection(new Set(rows.map(({ id }) => id)));
              }}
            >
              {t('review.selectWindow')}
            </button>{' '}
            <button
              onClick={() => {
                allViewSelected.current = true;
                setSelectionAll(true);
                setSelection(new Set(rows.map(({ id }) => id)));
              }}
            >
              {t('review.selectAllView')}
            </button>{' '}
            <button
              onClick={() => {
                allViewSelected.current = false;
                setSelectionAll(false);
                setSelection(new Set());
              }}
            >
              {t('review.clearSelection')}
            </button>
          </p>
          {(selection.size > 0 || selectionAll) && (
            <div
              className={styles.selectionBar}
              role="toolbar"
              aria-label={t('bulk.selectionActions')}
            >
              {(['delete', 'keep', 'later', 'undecided'] as const).map(
                (value) => (
                  <button
                    key={value}
                    disabled={
                      activeCommand ||
                      searching ||
                      (!selectionAll && selection.size > 10_000)
                    }
                    onClick={() => {
                      void prepareBulk(
                        value,
                        false,
                        null,
                        selectionAll ? null : [...selection],
                      );
                    }}
                  >
                    {t('bulk.selectedAction', {
                      action: t(actionMessage[value]),
                    })}
                  </button>
                ),
              )}
              {selection.size > 10_000 && !selectionAll && (
                <p>{t('bulk.selectionLimit')}</p>
              )}
            </div>
          )}
          {paged ? (
            <>
              <ul className={styles.nativeList}>
                {rows.slice(0, PAGE).map((row) => (
                  <li className={styles.nativeRow} key={row.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectionAll || selection.has(row.id)}
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
                    void loadWindow(Math.max(0, offset - PAGE));
                  }}
                >
                  {t('review.previous')}
                </button>
                <button
                  disabled={offset + PAGE >= total}
                  onClick={() => {
                    void loadWindow(offset + PAGE);
                  }}
                >
                  {t('review.next')}
                </button>
              </div>
            </>
          ) : (
            <ContextMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <ContextMenu.Trigger
                render={
                  <div
                    role="grid"
                    aria-label={t('review.entries')}
                    aria-colcount={1}
                    aria-multiselectable="true"
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
                  />
                }
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
                        aria-selected={selectionAll || selection.has(row.id)}
                        key={row.id}
                        data-index={virtual.index}
                        ref={virtualizer.measureElement}
                        className={`${styles.row} ${focusIndex === virtual.index ? styles.focused : ''} ${selectionAll || selection.has(row.id) ? styles.selected : ''}`}
                        style={{ transform: `translateY(${virtual.start}px)` }}
                        onClick={() => {
                          focusedIndex.current = virtual.index;
                          setFocusIndex(virtual.index);
                          grid.current?.focus();
                        }}
                        onContextMenu={() => {
                          focusedIndex.current = virtual.index;
                          setFocusIndex(virtual.index);
                        }}
                        onDoubleClick={() => {
                          void openDetail(row);
                        }}
                      >
                        <div
                          role="gridcell"
                          id={`review-cell-${virtual.index}`}
                        >
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
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner>
                  <ContextMenu.Popup className={styles.menu}>
                    <ContextMenu.Item
                      onClick={() => {
                        const row = rowAt(focusIndex);
                        if (row) void openDetail(row);
                      }}
                    >
                      {t('review.openDetail')}
                    </ContextMenu.Item>
                    {(['keep', 'delete', 'later', 'undecided'] as const).map(
                      (value) => (
                        <ContextMenu.Item
                          key={value}
                          disabled={activeCommand}
                          onClick={() => {
                            void command(value);
                          }}
                        >
                          {t(actionMessage[value])}
                        </ContextMenu.Item>
                      ),
                    )}
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.Root>
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
        </div>
        {error && (
          <div role="alert" className={styles.storageError}>
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
        {detailId && (
          <aside
            role="region"
            aria-label={t('review.detail')}
            className={styles.detail}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeDetail();
              }
            }}
          >
            <button onClick={() => closeDetail()}>
              <ArrowLeft size={20} aria-hidden="true" /> {t('review.back')}
            </button>
            <h2 ref={detailHeading} tabIndex={-1}>
              {t('review.detail')}
            </h2>
            <p className={styles.mobileSave}>
              {error && !saved
                ? t('review.notSaved')
                : saved
                  ? t('review.saved')
                  : t('review.saving')}
            </p>
            {detail && (
              <>
                <p className={styles.fullText} dir="auto">
                  {evidenceSegments(
                    detail.item.text ||
                      (detail.item.mediaCount !== null &&
                      detail.item.mediaCount > 0
                        ? t('review.mediaOnly')
                        : t('review.noText')),
                    currentAssessments.map(({ evidence }) => evidence),
                  ).map((segment, index) =>
                    segment.highlight ? (
                      <mark className={styles.evidence} key={index}>
                        {segment.text}
                      </mark>
                    ) : (
                      segment.text
                    ),
                  )}
                </p>
                <p>
                  {t('review.likesValue', {
                    count: detail.item.engagement.likes ?? -1,
                  })}
                </p>
                <p>{t('review.exportEngagement')}</p>
                {detail.item.kind === 'comment' && (
                  <p>{t('review.commentReference')}</p>
                )}
                {detail.item.reference.replyToHandle && (
                  <p>
                    {t('review.replyHandle', {
                      handle: detail.item.reference.replyToHandle,
                    })}
                  </p>
                )}
                {detail.item.reference.replyToId && (
                  <p>
                    {t('review.replyReference', {
                      id: detail.item.reference.replyToId,
                    })}
                  </p>
                )}
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
                    {currentAssessments.map((assessment) => {
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
                        {t(actionMessage[value])}{' '}
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
          </aside>
        )}
      </div>
      <BulkDialog
        open={bulkOpen}
        preview={bulkPreview}
        account={
          summary?.accounts.find(({ key }) => key === accountKey)?.handle ??
          accountKey
        }
        filterDescription={
          bulkSuggested
            ? `${t('bulk.suggestedFilter')}. ${filterLabels}`
            : filterLabels
        }
        overwrite={bulkOverwrite}
        loading={bulkLoading}
        replacement={bulkReplacement}
        error={error}
        onOverwrite={(value) => {
          void prepareBulk(
            bulkValue,
            value,
            null,
            bulkSelected.current,
            bulkSuggested,
          );
        }}
        onConfirm={() => {
          void confirmBulk();
        }}
        onCancel={cancelBulk}
        renderSources={(row) => (
          <>
            {row.sources.map((source, index) => (
              <Source key={index} source={source} />
            ))}
            {row.moreSources > 0 && (
              <span
                aria-label={t('review.moreSources', { count: row.moreSources })}
              >
                +{row.moreSources}
              </span>
            )}
          </>
        )}
      />
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
                  <strong>{historyKind(entry.kind)}</strong>{' '}
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
