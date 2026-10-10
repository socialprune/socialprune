import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  SkipForward,
  Undo2,
} from 'lucide-react';
import type {
  ItemDetail,
  WorkspaceReply,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useWorkspace, requestId } from '../social/workspace.ts';
import { PostCard } from '../social/PostCard.tsx';
import { platformLink } from '../review/model.ts';
import { useT } from '../i18n/index.ts';
import styles from '../social/Social.module.css';

type List = Extract<WorkspaceReply, { type: 'clickListOpened' }>;
type Entry = Extract<
  WorkspaceReply,
  { type: 'clickListEntries' }
>['entries'][number];

export function DeleteMode({
  client,
  platform,
}: {
  client: WorkspaceClient;
  platform: 'x' | 'instagram';
}) {
  const t = useT();
  const { summary, revision, error: openError } = useWorkspace(client);
  const [accountKey, setAccountKey] = useState('');
  const [accounts, setAccounts] = useState<
    NonNullable<typeof summary>['accounts']
  >([]);
  const [list, setList] = useState<List | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [last, setLast] = useState<Entry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const sequence = useRef(0);
  const recording = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const focusAfter = useRef(false);

  useEffect(() => {
    if (!summary) return;
    let active = true;
    void Promise.all(
      summary.accounts.map(async (account) => {
        const queryId = requestId();
        const result = await client.request({
          type: 'query',
          requestId: requestId(),
          queryId,
          generation: 1,
          accountKey: account.key,
          filter: {},
          sort: [{ by: 'createdAt', direction: 'desc' }],
          search: '',
        });
        if (result.type !== 'queryResult' || !result.total) return null;
        const window = await client.request({
          type: 'window',
          requestId: requestId(),
          queryId,
          generation: 1,
          offset: 0,
          limit: 1,
        });
        if (window.type !== 'rows' || !window.rows[0]) return null;
        const detail = await client.request({
          type: 'detail',
          requestId: requestId(),
          itemId: window.rows[0].id,
        });
        return detail.type === 'itemDetail' && detail.item.platform === platform
          ? account
          : null;
      }),
    )
      .then((known) => {
        if (!active) return;
        const matching = known.filter((account) => account !== null);
        setAccounts(matching);
        setAccountKey((value) =>
          matching.some((account) => account.key === value)
            ? value
            : (matching[0]?.key ?? ''),
        );
        if (!matching.length) setLoading(false);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [client, summary?.accounts, platform]);
  useEffect(() => {
    if (!accountKey) return;
    const version = ++sequence.current;
    setLoading(true);
    setEntry(null);
    setDetail(null);
    void (async () => {
      const listId = requestId();
      const opened = await client.request({
        type: 'clickListOpen',
        requestId: requestId(),
        listId,
        accountKey,
        systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (opened.type !== 'clickListOpened') throw new Error('List rejected');
      if (version !== sequence.current) return;
      setList(opened);
      for (let offset = 0; offset < opened.total; offset += 200) {
        const window = await client.request({
          type: 'clickListWindow',
          requestId: requestId(),
          listId,
          offset,
          limit: 200,
        });
        if (version !== sequence.current) return;
        if (window.type !== 'clickListEntries')
          throw new Error('Window rejected');
        const next = window.entries.find(
          (entry) => entry.outcome === 'unknown',
        );
        if (!next) continue;
        const full = await client.request({
          type: 'detail',
          requestId: requestId(),
          itemId: next.itemId,
        });
        if (version !== sequence.current) return;
        if (full.type !== 'itemDetail') throw new Error('Detail rejected');
        setEntry(next);
        setDetail(full);
        return;
      }
    })()
      .catch(() => {
        if (version === sequence.current) setError(true);
      })
      .finally(() => {
        if (version === sequence.current) setLoading(false);
      });
    return () => {
      sequence.current++;
    };
  }, [client, accountKey, revision, refresh]);
  useEffect(() => {
    if (!loading && focusAfter.current) {
      stage.current?.focus();
      focusAfter.current = false;
    }
  }, [loading]);
  async function record(
    target: Entry,
    value: 'deleted-by-user' | 'skipped' | 'unknown',
  ) {
    if (recording.current || busy) return;
    recording.current = true;
    setBusy(true);
    setError(false);
    try {
      const reply = await client.request({
        type: 'outcome',
        requestId: requestId(),
        commandId: requestId(),
        itemIds: [target.itemId],
        value,
        expected: { [target.itemId]: target.outcome },
      });
      if (reply.type !== 'committed') throw new Error('Outcome rejected');
      setLast(value === 'unknown' ? null : { ...target, outcome: value });
      setYear(new Date(target.createdAt).getFullYear().toString());
      setNotice(
        t(value === 'unknown' ? 'clicklist.corrected' : 'clicklist.recorded'),
      );
      setRefresh((n) => n + 1);
      focusAfter.current = true;
    } catch {
      setError(true);
    } finally {
      recording.current = false;
      setBusy(false);
    }
  }
  const link = platform === 'x' && entry ? platformLink(entry.url) : null;
  const completed = list ? list.counts.deletedByYou + list.counts.skipped : 0;
  return (
    <section data-testid="delete-mode">
      <div className={styles.layout}>
        <div className={styles.column}>
          <div className={styles.controls}>
            <a
              href="#/clicklist/x/go"
              aria-current={platform === 'x' ? 'page' : undefined}
            >
              {t('clicklist.x')}
            </a>
            <a
              href="#/clicklist/instagram/go"
              aria-current={platform === 'instagram' ? 'page' : undefined}
            >
              {t('clicklist.instagram')}
            </a>
            <label className={styles.field}>
              {t('review.account')}
              <select
                value={accountKey}
                onChange={(e) => {
                  setAccountKey(e.target.value);
                  setLast(null);
                  setNotice(null);
                  setYear(null);
                }}
              >
                {accounts.map((account) => (
                  <option key={account.key} value={account.key}>
                    @{account.handle ?? account.key}
                  </option>
                ))}
              </select>
            </label>
            <a href={`#/clicklist/${platform}`}>{t('proto.fullClickList')}</a>
          </div>
          <div className={styles.progressLine}>
            <strong>
              {t('proto.goProgress', {
                count: completed,
                total: list?.total ?? 0,
              })}
            </strong>
            <span>{t('proto.left', { count: list?.counts.left ?? 0 })}</span>
          </div>
          <progress
            className={styles.progress}
            aria-label={t('proto.goTitle')}
            value={completed}
            max={Math.max(list?.total ?? 0, 1)}
          />
          <div
            ref={stage}
            tabIndex={0}
            role="region"
            aria-label={t('proto.goKeys')}
            data-testid="delete-card"
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                localStorage.getItem('sp-single-keys') === 'off'
              )
                return;
              if (event.key === 'Enter' || event.key === ' ')
                event.preventDefault();
              if (event.repeat || busy || loading || !entry) return;
              if (event.key === 'Enter' && link)
                stage.current
                  ?.querySelector<HTMLAnchorElement>('[data-open-platform]')
                  ?.click();
              if (event.key === ' ') void record(entry, 'deleted-by-user');
              if (event.key.toLowerCase() === 's')
                void record(entry, 'skipped');
            }}
          >
            <div className={styles.card}>
              {entry && detail ? (
                <>
                  <PostCard item={detail.item} zone={list?.timeZone} />
                  <div className={styles.suggestion}>
                    <strong>
                      {t(
                        entry.action === 'undo-repost'
                          ? 'clicklist.undoRepost'
                          : entry.action === 'delete-comment'
                            ? 'clicklist.deleteComment'
                            : 'clicklist.deletePost',
                      )}
                    </strong>
                    {platform === 'instagram' && (
                      <span className={styles.hint}>
                        {t('clicklist.stepsPending')}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className={styles.empty}>
                  {loading ? (
                    t('gate.preparing')
                  ) : (
                    <>
                      <CheckCircle2 size={40} aria-hidden="true" />
                      <h2>
                        {t(list?.total ? 'proto.goDone' : 'clicklist.empty')}
                      </h2>
                      <p>
                        {year
                          ? t('proto.goDoneYear', { year })
                          : t('proto.goDoneBody')}
                      </p>
                      <a href="#/archive">{t('proto.archiveTitle')}</a>
                    </>
                  )}
                </div>
              )}
            </div>
            {link && (
              <div className={styles.smallActions}>
                <a
                  className={styles.primary}
                  href={link}
                  data-open-platform
                  target="_blank"
                  rel="noopener noreferrer"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.repeat)
                      event.preventDefault();
                  }}
                >
                  <ExternalLink size={20} aria-hidden="true" />
                  {t('review.openX')}
                  <kbd className={styles.key}>Enter</kbd>
                </a>
              </div>
            )}
            <div className={`${styles.decisions} ${styles.twoActions}`}>
              <button
                className={styles.keep}
                disabled={busy || loading || !entry}
                onClick={() => {
                  if (entry) void record(entry, 'deleted-by-user');
                }}
              >
                <Check size={20} aria-hidden="true" />
                {t('proto.didIt')}
                <kbd className={styles.key}>{t('proto.spaceKey')}</kbd>
              </button>
              <button
                disabled={busy || loading || !entry}
                onClick={() => {
                  if (entry) void record(entry, 'skipped');
                }}
              >
                <SkipForward size={20} aria-hidden="true" />
                {t('clicklist.skip')}
                <kbd className={styles.key}>S</kbd>
              </button>
            </div>
          </div>
          <p className={styles.hint}>{t('proto.goKeysShort')}</p>
          <div className={styles.smallActions}>
            <p className={styles.notice} role="status">
              {notice ?? t('proto.manualOnly')}
            </p>
            {last && (
              <button
                className={styles.textButton}
                disabled={busy}
                onClick={() => {
                  void record(last, 'unknown');
                }}
              >
                <Undo2 size={16} aria-hidden="true" />
                {t('clicklist.correct')}
              </button>
            )}
          </div>
          {(error || openError) && (
            <p className={styles.error} role="alert">
              {t('workspace.storageError')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
