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
  const [notice, setNotice] = useState('');
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
  const [oneAtATime, setOneAtATime] = useState(false);
  const [singleIndex, setSingleIndex] = useState(0);
  const anchors = useRef<Partial<Record<FeedTab, string>>>({
    ...client.summary?.review?.feed?.anchors,
  });
  const root = useRef<HTMLDivElement>(null);
  const activeAnchor = useRef<string | undefined>(anchors.current[tab]);
  const persistence = useRef<Promise<unknown>>(Promise.resolve());
  const pendingFocus = useRef<string | null>(null);
  const focusSequence = useRef(0);
  const scrollAnchor = useRef<{ id: string; top: number } | null>(null);
  const localCommand = useRef(false);
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
    const summary = client.summary;
    if (!summary || !nextAccount) return;
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
            feed: { tab: nextTab, anchors: { ...anchors.current } },
          },
        });
        if (reply.type !== 'reviewViewChanged')
          setNotice(t('review.storageError'));
      });
  }
  useEffect(() => {
    if (!accountKey && summary?.accounts[0]) {
      setAccount(
        summary.accounts.find(
          (account) => account.key === summary.review?.accountKey,
        )?.key ?? summary.accounts[0].key,
      );
      setTab(summary.review?.feed?.tab ?? 'suggested');
      anchors.current = { ...summary.review?.feed?.anchors };
    }
  }, [accountKey, summary]);
  useEffect(() => {
    if (!accountKey) return;
    setSingleIndex(0);
    setOriginals(new Map());
    activeAnchor.current = anchors.current[tab];
    opened.current = false;
    void session.open(accountKey, tab, activeAnchor.current).then(() => {
      opened.current = true;
      const panel =
        root.current?.querySelector<HTMLElement>('[role="tabpanel"]');
      if (panel) panel.scrollTop = 0;
    });
  }, [session, accountKey, tab]);
  useEffect(() => {
    const stop = client.subscribe((notice) => {
      if (notice.type !== 'changed' || localCommand.current || !opened.current)
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
  useEffect(() => {
    if (state.loading) return;
    const targetId = pendingFocus.current;
    if (!targetId) return;
    const target = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        'article[data-card-id]',
      ) ?? []),
    ].find((article) => article.dataset['cardId'] === targetId);
    if (target) {
      target.focus();
      pendingFocus.current = null;
    }
  }, [state.cards, state.loading]);
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
    const sequence = ++focusSequence.current;
    pendingFocus.current = null;
    const { accountKey, tab } = current.current;
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
  const decide = useCallback(
    async (id: string, value: DecisionValue) => {
      localCommand.current = true;
      pendingFocus.current = id;
      try {
        const saved = await session.decide(id, value);
        if (saved)
          setNotice(
            value === 'keep'
              ? translate('reviewFeed.keptNotice', {
                  count: session.snapshot.counts?.tabs.suggested ?? 0,
                })
              : translate('review.markNotice', { count: 1 }),
          );
      } finally {
        localCommand.current = false;
      }
    },
    [session, translate],
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
  async function undo() {
    if (state.busy || state.loading) return;
    localCommand.current = true;
    try {
      const reply = await session.undo(activeAnchor.current);
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
      localCommand.current = false;
    }
  }
  function editCriteria() {
    setEditorCounts(state.counts);
    setEditor(true);
  }
  async function saveCriteria() {
    localCommand.current = true;
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
      localCommand.current = false;
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
  const models = oneAtATime
    ? allModels.slice(singleIndex, singleIndex + 1)
    : allModels;
  return (
    <div
      ref={root}
      className={styles.workspace}
      data-testid="card-review"
      data-editor={editor}
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
            busy={state.busy || state.loading}
            error={state.error || openError}
            notice={notice}
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
              setOneAtATime(false);
              setTab(next);
              persist(next);
            }}
            onDecision={onDecision}
            onPreview={() => {
              setDialog(true);
              void session.preview();
            }}
            onDelete={() => {
              location.hash =
                platform === 'instagram'
                  ? '#/clicklist/instagram/go'
                  : '#/delete';
            }}
            onUndo={() => {
              void undo();
            }}
            onKeyboardHelp={() => setHelp(true)}
            onMove={(index) => {
              void move(index);
            }}
            onAnchor={(id) => {
              if (id === activeAnchor.current) return;
              activeAnchor.current = id;
              anchors.current[tab] = id;
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
                busy={state.busy}
                single={oneAtATime}
                previousDisabled={state.start + singleIndex === 0}
                nextDisabled={state.start + singleIndex >= state.total - 1}
                onAccount={(key) => {
                  anchors.current = {};
                  activeAnchor.current = undefined;
                  session.cancelPreview();
                  setAccount(key);
                  setTab('suggested');
                  setNotice('');
                  persist('suggested', key);
                }}
                onSingle={() => {
                  setOneAtATime((value) => !value);
                  setTab('suggested');
                  setSingleIndex(0);
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
          localCommand.current = true;
          void session
            .confirm()
            .then((result) => {
              if (result === 'saved') {
                setDialog(false);
                setNotice(t('reviewFeed.planSaved'));
                setTab('marked');
                persist('marked');
              }
            })
            .finally(() => {
              localCommand.current = false;
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
