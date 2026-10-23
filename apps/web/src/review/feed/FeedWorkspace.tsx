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
import { PRESETS, defaultCriteria } from '@socialprune/core/criteria';
import type { FeedTab } from '@socialprune/core/criteria';
import type { DecisionValue, Original } from '@socialprune/core';
import type { WorkspaceClient } from '../../workspace/client.ts';
import { useWorkspace, requestId } from '../../social/workspace.ts';
import { useT } from '../../i18n/index.ts';
import { FeedSession } from './session.ts';
import { adaptCard, adaptPreview, criterionLabel } from './adapt.ts';
import { ReviewFeed } from './ReviewFeed.tsx';
import { MarkPreview } from './MarkPreview.tsx';
import { FeedContext } from './FeedContext.tsx';
import { CriteriaPicker } from '../criteria/CriteriaPicker.tsx';
import { FeedToolbar } from './FeedToolbar.tsx';
import controls from './Controls.module.css';
import type { CriteriaModel } from '../criteria/types.ts';
import styles from './FeedWorkspace.module.css';

const definitions = {
  toxic: 'reviewFeed.definition.toxic',
  'personal-attack': 'reviewFeed.definition.personal-attack',
  political: 'reviewFeed.definition.political',
  sexual: 'reviewFeed.definition.sexual',
  'drugs-illegal': 'reviewFeed.definition.drugs-illegal',
  'personal-info': 'reviewFeed.definition.personal-info',
  embarrassing: 'reviewFeed.definition.embarrassing',
  empty: 'reviewFeed.definition.empty',
  racist: 'reviewFeed.definition.racist',
  misogynistic: 'reviewFeed.definition.misogynistic',
  'group-hostility': 'reviewFeed.definition.group-hostility',
  'politically-incorrect': 'reviewFeed.definition.politically-incorrect',
} as const;

export function FeedWorkspace({ client }: { client: WorkspaceClient }) {
  const t = useT();
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
  const [editorBusy, setEditorBusy] = useState(false);
  const [draft, setDraft] = useState<CriteriaModel | null>(null);
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
  const criteria = summary?.criteria ?? defaultCriteria();
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
        setOriginals(new Map());
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
    const destination = Math.min(
      Math.max(0, index),
      Math.max(0, state.total - 1),
    );
    const card = state.cards[destination - state.start];
    if (card) {
      if (oneAtATime) setSingleIndex(destination - state.start);
      setFocusTarget({ id: card.item.id, sequence: Date.now() });
      const target = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'article[data-card-id]',
        ) ?? []),
      ].find((article) => article.dataset['cardId'] === card.item.id);
      target?.focus();
      return;
    }
    await session.load(Math.floor(destination / 50) * 50);
    const next = session.snapshot.cards[destination - session.snapshot.start];
    if (next) {
      if (oneAtATime) setSingleIndex(destination - session.snapshot.start);
      setFocusTarget({ id: next.item.id, sequence: Date.now() });
      pendingFocus.current = next.item.id;
      requestAnimationFrame(() => {
        const target = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'article[data-card-id]',
          ) ?? []),
        ].find((article) => article.dataset['cardId'] === next.item.id);
        target?.focus();
      });
    }
  }
  async function decide(id: string, value: DecisionValue) {
    localCommand.current = true;
    pendingFocus.current = id;
    try {
      const saved = await session.decide(id, value);
      if (saved)
        setNotice(
          value === 'keep'
            ? t('reviewFeed.keptNotice', {
                count: session.snapshot.counts?.tabs.suggested ?? 0,
              })
            : t('review.markNotice', { count: 1 }),
        );
    } finally {
      localCommand.current = false;
    }
  }
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
    if (!summary) return;
    const selected = new Set(criteria.selected);
    setDraft({
      options: PRESETS.filter(
        (option) => !['harmless', 'unclear'].includes(option.id),
      ).map((option) => ({
        id: option.id,
        label: criterionLabel(option.id, summary, t),
        description: t(definitions[option.id as keyof typeof definitions]),
        selected: selected.has(option.id),
        hits: state.counts?.hits[option.id] ?? 0,
        unchecked: state.counts?.unchecked[option.id] ?? 0,
        noRoom:
          !(summary.categories ?? []).includes(option.id) &&
          (summary.categories?.length ?? 0) >= 32,
      })),
      level: criteria.level,
      ownLabel: '',
      ownDescription: '',
      suggested: state.counts?.tabs.suggested ?? 0,
      held: state.counts?.tabs.held ?? 0,
    });
    setEditor(true);
  }
  async function saveCriteria() {
    if (!draft) return;
    localCommand.current = true;
    setEditorBusy(true);
    try {
      const reply = await client.setCriteria({
        ...criteria,
        selected: [
          ...new Set([
            ...draft.options
              .filter((option) => option.selected)
              .map((option) => option.id),
            ...criteria.selected.filter(
              (id) => !PRESETS.some((preset) => preset.id === id),
            ),
          ]),
        ],
        level: draft.level,
      });
      if (reply.type !== 'settingsChanged')
        throw new Error('Criteria rejected');
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
      setEditorBusy(false);
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
  const allModels = state.cards.map((card) => ({
    ...adaptCard(card, summary, t, state.counts?.popularThreshold ?? null),
    busy: state.busy,
  }));
  const models = oneAtATime
    ? allModels.slice(singleIndex, singleIndex + 1)
    : allModels;
  return (
    <div ref={root} className={styles.workspace} data-testid="card-review">
      <div className={styles.layout} data-testid="review-card">
        {editor && draft ? (
          <section className={styles.editor}>
            <h2>{t('reviewFeed.change')}</h2>
            <CriteriaPicker
              model={{ ...draft, busy: editorBusy }}
              onToggle={(id, selected) =>
                setDraft(
                  (value) =>
                    value && {
                      ...value,
                      options: value.options.map((option) =>
                        option.id === id ? { ...option, selected } : option,
                      ),
                    },
                )
              }
              onLevel={(level) =>
                setDraft((value) => value && { ...value, level })
              }
              onOwnLabel={() => undefined}
              onOwnDescription={() => undefined}
              onAdd={() => undefined}
              onRemove={() => undefined}
              onOfferRule={() => undefined}
              presetsOnly
            />
            <div className={styles.editorFooter}>
              <button
                className={controls.primary}
                disabled={editorBusy}
                onClick={() => {
                  void saveCriteria();
                }}
              >
                {t('reviewFeed.applyCriteria')}
              </button>
              <button
                className={controls.button}
                disabled={editorBusy}
                onClick={() => setEditor(false)}
              >
                {t('bulk.cancel')}
              </button>
            </div>
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
            onDecision={(id, value) => {
              void decide(id, value);
            }}
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
            context={(model) => {
              const card = state.cards.find(
                (card) => card.item.id === model.id,
              );
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
            }}
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
        <aside className={styles.side}>
          <h2>{t('reviewFeed.planHeading')}</h2>
          <p>
            {criteria.selected
              .map((id) => criterionLabel(id, summary, t))
              .join(', ') || t('reviewFeed.emptyStart')}
          </p>
          <p>
            {t('reviewFeed.heldCount', { count: state.counts?.tabs.held ?? 0 })}
          </p>
          <p>{t('reviewFeed.keys')}</p>
        </aside>
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
