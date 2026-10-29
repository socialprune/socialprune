import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useIntl } from 'react-intl';
import { defaultCriteria } from '@socialprune/core/criteria';
import type { FeedTab } from '@socialprune/core/criteria';
import type { FeedSort } from '@socialprune/core/criteria';
import type { DecisionValue, Original } from '@socialprune/core';
import type { WorkspaceClient } from '../../workspace/client.ts';
import type { PlanCounts } from '@socialprune/core/workspace/protocol';
import { useWorkspace, requestId } from '../../social/workspace.ts';
import { useT } from '../../i18n/index.ts';
import { FeedSession } from './session.ts';
import { adaptCard, adaptPreview, criterionLabel } from './adapt.ts';
import { ReviewFeed } from './ReviewFeed.tsx';
import { MarkPreview } from './MarkPreview.tsx';
import { FeedContext } from './FeedContext.tsx';
import { ReviewSettings } from '../criteria/ReviewSettings.tsx';
import { FeedToolbar } from './FeedToolbar.tsx';
import controls from './Controls.module.css';
import type { FeedCardModel } from './types.ts';
import styles from './FeedWorkspace.module.css';
import { feedViews, feedChoice, changeFeedSort } from './sort-view.ts';
import { singleMode, setSingleMode } from './single-view.ts';

export function FeedWorkspace({ client }: { client: WorkspaceClient }) {
  const t = useT();
  const intl = useIntl();
  const translate = useMemo(() => t, [intl]);
  const { summary, error: openError } = useWorkspace(client);
  const session = useMemo(() => new FeedSession(client), [client]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [accountKey, setAccount] = useState(
    client.summary?.review?.accountKey ??
      client.summary?.accounts[0]?.key ??
      '',
  );
  const [tab, setTab] = useState<FeedTab>(
    client.summary?.review?.feed?.tab ?? 'suggested',
  );
  const views = useRef(feedViews(client.summary?.review));
  const [sort, setSort] = useState<FeedSort>(
    () => feedChoice(views.current, accountKey, tab).sort,
  );
  const [notice, setNotice] = useState('');
  const [tabPending, setTabPending] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState(false);
  const [, setEditorCounts] = useState<PlanCounts | null>(null);
  const [originals, setOriginals] = useState<ReadonlyMap<string, Original>>(
    new Map(),
  );
  const [focusTarget, setFocusTarget] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const [oneAtATime, setOneAtATime] = useState(() =>
    singleMode(summary?.workspaceId ?? '', accountKey, tab),
  );
  const [singleIndex, setSingleIndex] = useState(0);
  const singleStart = useRef(state.start);
  useLayoutEffect(() => {
    if (state.start !== singleStart.current) {
      const delta = state.start - singleStart.current;
      singleStart.current = state.start;
      if (oneAtATime) setSingleIndex((index) => Math.max(0, index - delta));
    }
  }, [state.start, oneAtATime]);
  const anchors = useRef<Partial<Record<FeedTab, string>>>({
    ...client.summary?.review?.feed?.anchors,
  });
  const root = useRef<HTMLDivElement>(null);
  const activeAnchor = useRef<string | undefined>(anchors.current[tab]);
  const persistence = useRef<Promise<unknown>>(Promise.resolve());
  const focusSequence = useRef(0);
  const [decisionKeysBlockedUntil, setDecisionKeysBlockedUntil] = useState(0);
  const scrollAnchor = useRef<{ id: string; top: number } | null>(null);
  const localCommand = useRef(0);
  const lifecycle = useRef(0);
  const previewOpen = useRef(false);
  previewOpen.current = dialog;
  const opened = useRef(false);
  const persistenceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const currentAccount = summary?.accounts.find(
    (account) => account.key === accountKey,
  );
  const zone =
    summary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const criteria =
    (editor ? client.summary?.criteria : summary?.criteria) ??
    defaultCriteria();
  const platform =
    (state.cards[0]?.item.platform ?? accountKey.split(':')[0]) === 'instagram'
      ? 'instagram'
      : 'x';
  const current = useRef({ accountKey, tab });
  current.current = { accountKey, tab };
  const visibleOriginals = useCallback(
    (ids: readonly string[]) => {
      const references = [
        ...new Set(
          ids.flatMap((id) => {
            const item = session.snapshot.cards.find(
              (card) => card.item.id === id,
            )?.item;
            const ref =
              item?.kind === 'reply'
                ? item.reference.replyToId
                : item?.kind === 'quote'
                  ? item.reference.quotedId
                  : null;
            return item?.platform === 'x' && ref && /^\d{1,40}$/.test(ref)
              ? [ref]
              : [];
          }),
        ),
      ];
      let active = true;
      if (!references.length) {
        setOriginals((value) => (value.size ? new Map() : value));
        return;
      }
      void client
        .getOriginals(references)
        .then((records) => {
          if (active)
            setOriginals(new Map(records.map((record) => [record.id, record])));
        })
        .catch(() => {
          if (active) setOriginals(new Map());
        });
      return () => {
        active = false;
      };
    },
    [client, session],
  );

  function persist(
    nextTab = current.current.tab,
    nextAccount = current.current.accountKey,
  ) {
    if (session.snapshot.revisiting) return;
    const summary = client.summary;
    if (!summary || !nextAccount) return;
    const feed = {
      tab: nextTab,
      anchors: { ...anchors.current },
      views: structuredClone(views.current),
    };
    persistence.current = persistence.current
      .catch(() => undefined)
      .then(async () => {
        const review = client.summary?.review;
        const reply = await client.request({
          type: 'setReviewView',
          requestId: requestId(),
          view: {
            ...(review ?? {
              filter: {},
              search: '',
              sort: [{ by: 'createdAt', direction: 'desc' }],
            }),
            accountKey: nextAccount,
            feed,
          },
        });
        if (reply.type !== 'reviewViewChanged')
          setNotice(t('review.storageError'));
      })
      .catch(() => setNotice(t('review.storageError')));
  }
  useEffect(() => {
    if (!accountKey && summary?.accounts[0]) {
      views.current = feedViews(summary.review);
      const key =
        summary.accounts.find(
          (account) => account.key === summary.review?.accountKey,
        )?.key ?? summary.accounts[0].key;
      const tab = summary.review?.feed?.tab ?? 'suggested';
      setAccount(
        summary.accounts.find(
          (account) => account.key === summary.review?.accountKey,
        )?.key ?? summary.accounts[0].key,
      );
      setTab(summary.review?.feed?.tab ?? 'suggested');
      anchors.current = { ...summary.review?.feed?.anchors };
      setSort(feedChoice(views.current, key, tab).sort);
      setOneAtATime(singleMode(summary.workspaceId, key, tab));
    }
  }, [accountKey, summary]);
  useEffect(() => {
    if (!accountKey) return;
    if (
      session.snapshot.revisiting &&
      session.snapshot.accountKey === accountKey
    )
      return;
    setSingleIndex(0);
    setOriginals(new Map());
    activeAnchor.current =
      feedChoice(views.current, accountKey, tab).anchor ?? anchors.current[tab];
    opened.current = false;
    void session.open(accountKey, tab, activeAnchor.current, sort).then(() => {
      opened.current = true;
      const panel =
        root.current?.querySelector<HTMLElement>('[role="tabpanel"]');
      if (panel) panel.scrollTop = 0;
    });
  }, [session, accountKey, tab, sort]);
  useEffect(() => {
    const stop = client.subscribe((notice) => {
      if (
        notice.type !== 'changed' ||
        localCommand.current ||
        client.commands.pending ||
        !opened.current
      )
        return;
      if (previewOpen.current) {
        void session.refreshCounts();
        return;
      }
      const { accountKey, tab } = current.current;
      void session.open(accountKey, tab, activeAnchor.current);
    });
    return stop;
  }, [client, session]);
  useLayoutEffect(() => {
    const failure = state.saveFailure;
    if (!failure) return;
    setDecisionKeysBlockedUntil(performance.now() + 500);
    setNotice(t('reviewFeed.saveFailed'));
    const index = state.cards.findIndex(
      (card) => card.item.id === failure.itemId,
    );
    if (index >= 0) setSingleIndex(index);
    setFocusTarget({ id: failure.itemId, sequence: ++focusSequence.current });
  }, [state.saveFailure]);
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href^="#/"]',
      );
      if (!anchor || !client.commands.pending || event.ctrlKey || event.metaKey)
        return;
      event.preventDefault();
      event.stopPropagation();
      const href = anchor.getAttribute('href')!;
      const failures = client.commands.failures;
      void client.flushCommands().then(() => {
        if (
          client.commands.failures === failures &&
          !client.commands.recovery &&
          !session.snapshot.saveFailure
        )
          window.location.hash = href;
      });
    };
    document.addEventListener('click', navigate, true);
    return () => document.removeEventListener('click', navigate, true);
  }, [client, session]);
  useEffect(() => {
    const generation = ++lifecycle.current;
    return () => {
      clearTimeout(persistenceTimer.current);
      queueMicrotask(() => {
        if (lifecycle.current === generation) {
          persist();
          session.dispose();
        }
      });
    };
  }, [session]);
  useLayoutEffect(() => {
    if (state.loading) return;
    const anchor = scrollAnchor.current;
    const panel = root.current?.querySelector<HTMLElement>('[role="tabpanel"]');
    if (!anchor || !panel) return;
    const article = [
      ...panel.querySelectorAll<HTMLElement>('article[data-card-id]'),
    ].find((article) => article.dataset['cardId'] === anchor.id);
    if (article)
      panel.scrollTop += article.getBoundingClientRect().top - anchor.top;
    scrollAnchor.current = null;
  }, [state.cards, state.loading]);
  async function loadWindow(offset: number) {
    const panel = root.current?.querySelector<HTMLElement>('[role="tabpanel"]');
    const first =
      panel &&
      [...panel.querySelectorAll<HTMLElement>('article[data-card-id]')].find(
        (article) =>
          article.getBoundingClientRect().bottom >
          panel.getBoundingClientRect().top,
      );
    if (first?.dataset['cardId'])
      scrollAnchor.current = {
        id: first.dataset['cardId'],
        top: first.getBoundingClientRect().top,
      };
    await session.load(offset);
  }

  async function move(index: number) {
    const { accountKey, tab } = current.current;
    if (session.snapshot.revisiting) {
      await session.open(accountKey, tab, activeAnchor.current, sort);
      index = session.snapshot.start;
    }
    const sequence = ++focusSequence.current;
    const id = await session.seek(index);
    if (
      !id ||
      sequence !== focusSequence.current ||
      accountKey !== current.current.accountKey ||
      tab !== current.current.tab
    )
      return;
    if (oneAtATime)
      setSingleIndex(
        session.snapshot.cards.findIndex((card) => card.item.id === id),
      );
    setFocusTarget({ id, sequence });
  }
  async function back() {
    if (!oneAtATime) return;
    clearTimeout(persistenceTimer.current);
    localCommand.current++;
    try {
      const id = await session.back();
      if (id) {
        setAccount(session.snapshot.accountKey);
        setSingleIndex(0);
        setFocusTarget({ id, sequence: ++focusSequence.current });
      }
    } finally {
      localCommand.current--;
    }
  }
  const decide = useCallback(
    async (id: string, value: DecisionValue) => {
      localCommand.current++;
      const before = session.snapshot.cards;
      const index = before.findIndex((card) => card.item.id === id);
      const saving = session.decide(id, value, !oneAtATime);
      const next =
        session.snapshot.cards.find(
          (card) => card.item.id === before[index + 1]?.item.id,
        ) ??
        session.snapshot.cards[
          Math.min(index, session.snapshot.cards.length - 1)
        ];
      if (oneAtATime && next && !session.snapshot.revisiting)
        setSingleIndex(session.snapshot.cards.indexOf(next));
      if (next)
        setFocusTarget({ id: next.item.id, sequence: ++focusSequence.current });
      if (oneAtATime && index >= session.snapshot.cards.length - 30)
        void session.prefetch(true);
      try {
        const saved = await saving;
        if (saved)
          setNotice(
            value === 'keep'
              ? translate('reviewFeed.keptNotice', {
                  count: session.snapshot.counts?.tabs.suggested ?? 0,
                })
              : translate('review.markNotice', { count: 1 }),
          );
      } finally {
        localCommand.current--;
      }
    },
    [session, translate, oneAtATime],
  );
  const onDecision = useCallback(
    (id: string, value: DecisionValue) => {
      void decide(id, value);
    },
    [decide],
  );
  const allModels = useMemo(
    () =>
      summary
        ? state.cards.map((card) =>
            adaptCard(
              card,
              summary,
              translate,
              state.counts?.popularThreshold ?? null,
            ),
          )
        : [],
    [state.cards, summary, translate, state.counts?.popularThreshold],
  );
  const renderContext = useCallback(
    (model: FeedCardModel) => {
      const card = state.cards.find((card) => card.item.id === model.id);
      return card ? (
        <FeedContext
          item={card.item}
          client={client}
          zone={zone}
          original={originals.get(
            card.item.kind === 'quote'
              ? (card.item.reference.quotedId ?? '')
              : (card.item.reference.replyToId ?? ''),
          )}
        />
      ) : null;
    },
    [state.cards, client, zone, originals],
  );
  async function undo(kind: 'undo' | 'redo' = 'undo') {
    if (state.busy) return;
    localCommand.current++;
    try {
      const reply = await session.undo(
        session.snapshot.cards[0]?.item.id ?? activeAnchor.current,
        kind,
      );
      if (!reply) {
        setNotice(t('review.noHistory'));
        return;
      }
      setNotice(
        t('review.undoNotice', {
          count: reply.changed,
          skipped: reply.skipped ?? 0,
        }),
      );
    } finally {
      localCommand.current--;
    }
  }
  function editCriteria() {
    setEditorCounts(state.counts);
    setEditor(true);
  }
  async function saveCriteria() {
    localCommand.current++;
    try {
      await client.open();
      setEditor(false);
      await session.open(accountKey, tab, activeAnchor.current);
      requestAnimationFrame(() => {
        root.current
          ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?.focus();
      });
    } catch {
      setNotice(t('review.storageError'));
    } finally {
      localCommand.current--;
    }
  }
  if (!summary)
    return (
      <p role={openError ? 'alert' : 'status'}>
        {t(openError ? 'review.storageError' : 'gate.preparing')}
      </p>
    );
  const zero = {
    suggested: 0,
    held: 0,
    kept: 0,
    unclear: 0,
    marked: 0,
    all: 0,
  };
  const unchecked = Object.entries(state.counts?.unchecked ?? {}).filter(
    ([id, count]) => criteria.selected.includes(id) && count > 0,
  );
  const viewPending =
    tabPending ||
    state.accountKey !== accountKey ||
    state.tab !== tab ||
    state.sort !== sort;
  const models = oneAtATime
    ? allModels.slice(singleIndex, singleIndex + 1)
    : allModels;
  return (
    <div
      ref={root}
      className={styles.workspace}
      data-testid="card-review"
      data-editor={editor}
      data-platform={platform === 'instagram' ? platform : undefined}
      data-single={oneAtATime}
    >
      <div className={styles.layout} data-testid="review-card">
        {editor ? (
          <section className={styles.editor}>
            <h2>{t('reviewFeed.change')}</h2>
            {state.counts && (
              <ReviewSettings
                client={client}
                summary={summary}
                counts={state.counts}
                accountKey={accountKey}
                onDone={() => void saveCriteria()}
                onChanged={setEditorCounts}
              />
            )}
          </section>
        ) : (
          <ReviewFeed
            account={currentAccount?.handle ?? accountKey}
            platform={platform}
            criteria={
              criteria.selected
                .map((id) => criterionLabel(id, summary, t))
                .join(', ') || t('reviewFeed.noCriteria')
            }
            hasCriteria={criteria.selected.length > 0}
            counts={state.counts?.tabs ?? zero}
            tab={tab}
            cards={models}
            start={state.start + (oneAtATime ? singleIndex : 0)}
            virtualized={!oneAtATime}
            onVisible={visibleOriginals}
            focusTarget={focusTarget}
            total={state.total}
            busy={state.busy || state.loading || viewPending}
            error={state.error || openError}
            notice={
              state.historyBlocked
                ? t('reviewFeed.historyBlocked')
                : state.saveFailure
                  ? t('reviewFeed.saveFailed')
                  : state.pending
                    ? t('reviewFeed.saving', { count: state.pending })
                    : notice
            }
            zone={zone}
            singleKeys={
              localStorage.getItem('sp-single-keys') !== 'off' &&
              !dialog &&
              !help
            }
            onCriteria={editCriteria}
            onCheck={() => setNotice(t('reviewFeed.sourceLater'))}
            onRetry={() => {
              void session.open(accountKey, tab, activeAnchor.current);
            }}
            onTab={(next) => {
              if (client.commands.pending) {
                setTabPending(true);
                void session.flush().then(() => {
                  setTabPending(false);
                  if (session.snapshot.saveFailure) return;
                  setOneAtATime(
                    singleMode(summary?.workspaceId ?? '', accountKey, next),
                  );
                  setTab(next);
                  setSort(feedChoice(views.current, accountKey, next).sort);
                  persist(next);
                });
                return;
              }
              setOneAtATime(
                singleMode(summary?.workspaceId ?? '', accountKey, next),
              );
              setTab(next);
              setSort(feedChoice(views.current, accountKey, next).sort);
              persist(next);
            }}
            onDecision={onDecision}
            decisionKeysBlockedUntil={decisionKeysBlockedUntil}
            onPreview={() => {
              setDialog(true);
              void session.preview();
            }}
            onDelete={() => {
              void session.flush().then(() => {
                if (session.snapshot.saveFailure) return;
                location.hash =
                  platform === 'instagram'
                    ? '#/clicklist/instagram/go'
                    : '#/delete';
              });
            }}
            onUndo={(redo) => {
              void undo(redo ? 'redo' : 'undo');
            }}
            onBack={oneAtATime ? () => void back() : undefined}
            onDrain={() => session.flush()}
            onKeyboardHelp={() => setHelp(true)}
            onMove={(index) => {
              void move(index);
            }}
            onAnchor={(id) => {
              if (session.snapshot.revisiting) return;
              if (id === activeAnchor.current) return;
              activeAnchor.current = id;
              anchors.current[tab] = id;
              views.current = {
                ...views.current,
                [accountKey]: {
                  ...views.current[accountKey],
                  [tab]: { sort, anchor: id },
                },
              };
              clearTimeout(persistenceTimer.current);
              persistenceTimer.current = setTimeout(() => persist(), 250);
            }}
            hasNext={state.start + state.cards.length < state.total}
            hasPrevious={state.start > 0}
            onNextWindow={() => {
              void loadWindow(state.start + state.cards.length);
            }}
            onPreviousWindow={() => {
              void loadWindow(Math.max(0, state.start - 50));
            }}
            context={renderContext}
            unchecked={
              unchecked.length
                ? {
                    count: unchecked[0]![1],
                    criterion: unchecked
                      .map(([id]) => criterionLabel(id, summary, t))
                      .join(', '),
                  }
                : undefined
            }
            header={
              <FeedToolbar
                accounts={summary.accounts}
                accountKey={accountKey}
                sort={sort}
                sortOptions={
                  state.accountKey === accountKey
                    ? state.sortOptions
                    : ['newest', 'oldest']
                }
                onSort={(next) => {
                  clearTimeout(persistenceTimer.current);
                  views.current = changeFeedSort(
                    views.current,
                    accountKey,
                    tab,
                    next,
                  );
                  delete anchors.current[tab];
                  activeAnchor.current = undefined;
                  setSort(next);
                  persist();
                }}
                busy={state.busy || state.pending > 0}
                single={oneAtATime}
                onBack={() => void back()}
                backDisabled={
                  !state.backAvailable || state.loading || state.busy
                }
                previousDisabled={state.start + singleIndex === 0}
                nextDisabled={
                  !state.revisiting &&
                  state.start + singleIndex >= state.total - 1
                }
                onAccount={(key) => {
                  anchors.current = Object.fromEntries(
                    Object.entries(views.current[key] ?? {}).flatMap(
                      ([tab, choice]) =>
                        choice?.anchor ? [[tab, choice.anchor]] : [],
                    ),
                  );
                  activeAnchor.current = undefined;
                  session.cancelPreview();
                  setAccount(key);
                  setTab('suggested');
                  setSort(feedChoice(views.current, key, 'suggested').sort);
                  setOneAtATime(
                    singleMode(summary?.workspaceId ?? '', key, 'suggested'),
                  );
                  setNotice('');
                  persist('suggested', key);
                }}
                onSingle={() => {
                  const single = !oneAtATime;
                  if (session.snapshot.revisiting)
                    void session.open(
                      accountKey,
                      tab,
                      activeAnchor.current,
                      sort,
                    );
                  setSingleMode(
                    summary?.workspaceId ?? '',
                    accountKey,
                    tab,
                    single,
                  );
                  setOneAtATime(single);
                  setSingleIndex(0);
                  persist();
                }}
                onMove={(direction) => {
                  void move(state.start + singleIndex + direction);
                }}
                onUndo={() => {
                  void undo();
                }}
                onHelp={() => setHelp(true)}
              />
            }
          />
        )}
      </div>
      <MarkPreview
        busy={state.busy}
        open={dialog}
        preview={adaptPreview(
          state.preview,
          summary,
          accountKey,
          t,
          state.previewState,
        )}
        zone={zone}
        onCancel={() => {
          session.cancelPreview();
          setDialog(false);
        }}
        onConfirm={() => {
          localCommand.current++;
          void session
            .confirm()
            .then((result) => {
              if (result === 'saved') {
                setDialog(false);
                setNotice(t('reviewFeed.planSaved'));
                setTab('marked');
                setSort(feedChoice(views.current, accountKey, 'marked').sort);
                persist('marked');
              }
            })
            .finally(() => {
              localCommand.current--;
            });
        }}
      />
      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.help}>
            <Dialog.Title>{t('review.keyboard')}</Dialog.Title>
            <Dialog.Description>{t('reviewFeed.keys')}</Dialog.Description>
            <p>{t('reviewFeed.helpBody')}</p>
            <Dialog.Close className={controls.button}>
              {t('review.close')}
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
