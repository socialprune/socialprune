import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import type { WorkspaceClient } from '../workspace/client.ts';
import type {
  WorkspaceSummary,
  WorkspaceReply,
} from '@socialprune/core/workspace/protocol';
type ClickListWindow = Extract<WorkspaceReply, { type: 'clickListEntries' }>;
type ClickListEntry = ClickListWindow['entries'][number];
type ClickListSummary = Omit<
  ClickListWindow,
  'entries' | 'offset' | 'requestId' | 'type'
>;
import { useT } from '../i18n/index.ts';
import { platformLink } from '../review/model.ts';
import { saveTextDownload } from './download.ts';
import { estimateMinutes, OutcomePace } from './pace.ts';
import styles from './ClickList.module.css';
import { TimeZone } from '../settings/TimeZone.tsx';

const actionMessage = {
  delete: 'clicklist.deletePost',
  'undo-repost': 'clicklist.undoRepost',
  'delete-comment': 'clicklist.deleteComment',
} as const;
export function ClickList({
  client,
  platform,
}: {
  client: WorkspaceClient;
  platform: 'x' | 'instagram';
}) {
  const t = useT(),
    intl = useIntl();
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(
    client.summary,
  );
  const [accountKey, setAccountKey] = useState('');
  const [accounts, setAccounts] = useState<WorkspaceSummary['accounts']>([]);
  const [summary, setSummary] = useState<ClickListSummary | null>(null);
  const [entries, setEntries] = useState<ClickListEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [started, setStarted] = useState(false);
  const [focused, setFocused] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [seconds, setSeconds] = useState(10);
  const [showTime, setShowTime] = useState(true);
  const [measured, setMeasured] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [changeZone, setChangeZone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasHistoryUndo, setHasHistoryUndo] = useState(false);
  const lastRecorded = useRef<ClickListEntry | null>(null);
  const recording = useRef(false);
  const listId = useRef(crypto.randomUUID());
  const pace = useRef(new OutcomePace());
  const generation = useRef(0);
  const entryButtons = useRef(new Map<string, HTMLLIElement>());
  const focusAfter = useRef(false);
  useEffect(
    () =>
      client.subscribe((message) => {
        if (message.type === 'changed') setRefresh(message.revision);
      }),
    [client],
  );
  useEffect(() => {
    let active = true;
    void client
      .open()
      .then(async (reply) => {
        if (!active) return;
        if (reply.type !== 'opened') {
          setError(true);
          return;
        }
        setWorkspace(reply.summary);
        const known = await Promise.all(
          reply.summary.accounts.map(async (account) => {
            const queryId = crypto.randomUUID();
            const query = await client.request({
              type: 'query',
              requestId: crypto.randomUUID(),
              queryId,
              generation: 1,
              accountKey: account.key,
              filter: {},
              sort: [{ by: 'id', direction: 'asc' }],
              search: '',
            });
            if (query.type !== 'queryResult' || !query.total) return null;
            const window = await client.request({
              type: 'window',
              requestId: crypto.randomUUID(),
              queryId,
              generation: 1,
              offset: 0,
              limit: 1,
            });
            if (window.type !== 'rows' || !window.rows[0]) return null;
            const detail = await client.request({
              type: 'detail',
              requestId: crypto.randomUUID(),
              itemId: window.rows[0].id,
            });
            return detail.type === 'itemDetail' &&
              detail.item.platform === platform
              ? account
              : null;
          }),
        );
        if (active) {
          const matching = known.filter((account) => account !== null);
          setAccounts(matching);
          setAccountKey(matching[0]?.key ?? '');
        }
      })
      .catch(() => setError(true));
    return () => {
      active = false;
      generation.current++;
    };
  }, [client, platform]);
  useEffect(() => {
    if (!accountKey) return;
    const current = ++generation.current;
    const snapshotId = crypto.randomUUID();
    void client
      .request({
        type: 'clickListOpen',
        requestId: crypto.randomUUID(),
        listId: snapshotId,
        accountKey,
        systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      .then(async (reply) => {
        if (current !== generation.current) return;
        if (reply.type !== 'clickListOpened') {
          setError(true);
          return;
        }
        setSummary(reply);
        const rows = await client.request({
          type: 'clickListWindow',
          requestId: crypto.randomUUID(),
          listId: snapshotId,
          offset,
          limit: 100,
        });
        if (
          rows.type === 'clickListEntries' &&
          current === generation.current
        ) {
          setEntries(rows.entries);
          setSummary(rows);
          listId.current = snapshotId;
        } else if (current === generation.current) setError(true);
      })
      .catch(() => setError(true));
  }, [client, accountKey, offset, refresh]);
  useEffect(() => {
    if (focusAfter.current && entries[focused]) {
      entryButtons.current.get(entries[focused].itemId)?.focus();
      focusAfter.current = false;
    }
  }, [entries, focused]);
  async function record(
    entry: ClickListEntry,
    value: 'deleted-by-user' | 'skipped' | 'unknown',
  ) {
    if (busy || recording.current) return;
    recording.current = true;
    setBusy(true);
    setError(false);
    try {
      const reply = await client.request({
        type: 'outcome',
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        itemIds: [entry.itemId],
        value,
        expected: { [entry.itemId]: entry.outcome },
      });
      if (reply.type !== 'committed') throw new Error('Outcome rejected.');
      setEntries((rows) =>
        rows.map((row) =>
          row.itemId === entry.itemId ? { ...row, outcome: value } : row,
        ),
      );
      if (reply.changed && value !== 'unknown') pace.current.record();
      setMeasured(pace.current.seconds());
      setNotice(
        t(value === 'unknown' ? 'clicklist.corrected' : 'clicklist.recorded'),
      );
      setHasHistoryUndo(value !== 'unknown');
      lastRecorded.current =
        value === 'unknown' ? null : { ...entry, outcome: value };
      focusAfter.current = true;
      setFocused((value) => Math.min(value + 1, entries.length - 1));
      setRefresh(reply.revision);
    } catch {
      setError(true);
    } finally {
      recording.current = false;
      setBusy(false);
    }
  }
  async function undoLatest() {
    const entry = lastRecorded.current;
    if (entry) await record(entry, 'unknown');
  }
  async function exportList(format: 'csv' | 'json') {
    setBusy(true);
    setError(false);
    try {
      await saveTextDownload(
        `socialprune-${platform}-clicklist.${format}`,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
        (write) => client.exportClickList(listId.current, format, write),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const time = measured ?? seconds;
  return (
    <section aria-label={t('clicklist.title')}>
      {workspace?.kind === 'demo' && <p>{t('demo.banner')}</p>}
      <p className={styles.notice}>
        {t(
          platform === 'x' ? 'clicklist.noticeX' : 'clicklist.noticeInstagram',
        )}
      </p>
      <div className={styles.controls}>
        <label className={styles.field}>
          {t('review.account')}
          <select
            value={accountKey}
            onChange={(event) => {
              setAccountKey(event.target.value);
              setOffset(0);
              setFocused(0);
              setStarted(false);
              setMeasured(null);
              lastRecorded.current = null;
              setHasHistoryUndo(false);
              setNotice(null);
            }}
          >
            {accounts.map((account) => (
              <option key={account.key} value={account.key}>
                {account.handle ?? account.key}
              </option>
            ))}
          </select>
        </label>
      </div>
      {summary && (
        <>
          <p className={styles.progress} role="status">
            {t('clicklist.progress', {
              deleted: summary.counts.deletedByYou,
              skipped: summary.counts.skipped,
              left: summary.counts.left,
            })}
          </p>
          {platform === 'instagram' && (
            <>
              <p>
                <span>
                  {t(
                    summary.timeZoneSource === 'workspace'
                      ? 'clicklist.zoneChosen'
                      : 'clicklist.zoneBrowser',
                    { zone: summary.timeZone },
                  )}
                </span>{' '}
                <button onClick={() => setChangeZone((value) => !value)}>
                  {t('clicklist.change')}
                </button>
              </p>
              {changeZone && (
                <TimeZone
                  client={client}
                  value={
                    summary.timeZoneSource === 'workspace'
                      ? summary.timeZone
                      : null
                  }
                  onChanged={(timeZone) => {
                    setWorkspace((value) =>
                      value ? { ...value, timeZone } : null,
                    );
                    setRefresh((value) => value + 1);
                    setChangeZone(false);
                  }}
                />
              )}
            </>
          )}
          {showTime && (
            <div className={styles.preview}>
              <label className={styles.field}>
                {t('clicklist.seconds')}
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={seconds}
                  onChange={(event) =>
                    setSeconds(
                      Math.max(
                        1,
                        Math.min(3600, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </label>
              <p>
                {t(
                  measured === null
                    ? 'clicklist.estimate'
                    : 'clicklist.measured',
                  {
                    seconds: Math.round(time),
                    count: summary.counts.left,
                    minutes: estimateMinutes(summary.counts.left, time),
                  },
                )}
              </p>
            </div>
          )}
          <div className={styles.actions}>
            <button onClick={() => setShowTime((value) => !value)}>
              {t(
                showTime ? 'clicklist.hideEstimate' : 'clicklist.showEstimate',
              )}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void exportList('csv');
              }}
            >
              {t('clicklist.exportCsv')}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void exportList('json');
              }}
            >
              {t('clicklist.exportJson')}
            </button>
          </div>
          {!started && (
            <div className={styles.preview}>
              <p>{t('clicklist.preview', { count: summary.total })}</p>
              <p>{entries[0]?.text ?? t('clicklist.empty')}</p>
              <button
                disabled={!summary.total}
                onClick={() => {
                  pace.current.begin();
                  setStarted(true);
                  requestAnimationFrame(
                    () =>
                      entries[0] &&
                      entryButtons.current.get(entries[0].itemId)?.focus(),
                  );
                }}
              >
                {t('clicklist.start')}
              </button>
            </div>
          )}
          {started && (
            <ol className={styles.list} aria-label={t('clicklist.entries')}>
              {entries.map((entry, index) => (
                <li
                  key={entry.itemId}
                  tabIndex={index === focused ? 0 : -1}
                  ref={(element) => {
                    if (element)
                      entryButtons.current.set(entry.itemId, element);
                    else entryButtons.current.delete(entry.itemId);
                  }}
                  onFocus={() => setFocused(index)}
                  className={`${styles.entry} ${index === focused ? styles.active : ''}`}
                  data-item-id={entry.itemId}
                  onKeyDown={(event) => {
                    if (
                      event.target !== event.currentTarget ||
                      event.altKey ||
                      event.ctrlKey ||
                      event.metaKey
                    )
                      return;
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const next = Math.min(
                        entries.length - 1,
                        Math.max(
                          0,
                          index + (event.key === 'ArrowDown' ? 1 : -1),
                        ),
                      );
                      setFocused(next);
                      entryButtons.current.get(entries[next]!.itemId)?.focus();
                    }
                    if (localStorage.getItem('sp-single-keys') === 'off')
                      return;
                    if (event.key === 'Enter' && platform === 'x') {
                      const link =
                        event.currentTarget.querySelector<HTMLAnchorElement>(
                          'a[data-open-platform]',
                        );
                      if (link) {
                        event.preventDefault();
                        link.click();
                      }
                    }
                    if (
                      event.key.toLowerCase() === 'd' ||
                      event.key.toLowerCase() === 's'
                    ) {
                      event.preventDefault();
                      void record(
                        entry,
                        event.key.toLowerCase() === 'd'
                          ? 'deleted-by-user'
                          : 'skipped',
                      );
                    }
                  }}
                >
                  {platform === 'instagram' &&
                    (index === 0 || entries[index - 1]?.day !== entry.day) && (
                      <>
                        <h2 className={styles.day}>{entry.day}</h2>
                        <p>{t('clicklist.stepsPending')}</p>
                      </>
                    )}
                  <time dateTime={entry.createdAt}>
                    {intl.formatDate(entry.createdAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: summary.timeZone,
                    })}
                  </time>
                  <p className={styles.text} dir="auto">
                    {entry.text || t('review.noText')}
                  </p>
                  {entry.ownerHandle && (
                    <p>{t('clicklist.owner', { owner: entry.ownerHandle })}</p>
                  )}
                  <p>{t(actionMessage[entry.action])}</p>
                  <p>
                    {t(
                      entry.outcome === 'deleted-by-user'
                        ? 'review.outcomeDeleted'
                        : entry.outcome === 'skipped'
                          ? 'review.outcomeSkipped'
                          : 'review.outcomeUnknown',
                    )}
                  </p>
                  <div className={styles.actions}>
                    {platform === 'x' && platformLink(entry.url) && (
                      <a
                        data-open-platform
                        href={platformLink(entry.url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('review.openX')}
                      </a>
                    )}
                    <button
                      disabled={busy || entry.outcome === 'deleted-by-user'}
                      onClick={() => {
                        setFocused(index);
                        void record(entry, 'deleted-by-user');
                      }}
                    >
                      {t('clicklist.didIt')}
                    </button>
                    <button
                      disabled={busy || entry.outcome === 'skipped'}
                      onClick={() => {
                        setFocused(index);
                        void record(entry, 'skipped');
                      }}
                    >
                      {t('clicklist.skip')}
                    </button>
                    {entry.outcome !== 'unknown' && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setFocused(index);
                          void record(entry, 'unknown');
                        }}
                      >
                        {t('clicklist.correct')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {started && (
            <div className={styles.actions}>
              <button
                disabled={!offset}
                onClick={() => {
                  setOffset(Math.max(0, offset - 100));
                  setFocused(0);
                }}
              >
                {t('review.previous')}
              </button>
              <button
                disabled={offset + 100 >= summary.total}
                onClick={() => {
                  setOffset(offset + 100);
                  setFocused(0);
                }}
              >
                {t('review.next')}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <div role="alert">
          <p>{t('workspace.storageError')}</p>
          <button
            onClick={() => {
              void client.downloadBackup();
            }}
          >
            {t('workspace.backup')}
          </button>
        </div>
      )}
      {notice && (
        <p role="status">
          {notice}{' '}
          {hasHistoryUndo && (
            <button
              disabled={busy}
              onClick={() => {
                void undoLatest();
              }}
            >
              {t('review.undo')}
            </button>
          )}
        </p>
      )}
    </section>
  );
}
