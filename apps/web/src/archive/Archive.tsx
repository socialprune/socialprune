import { useEffect, useMemo, useRef, useState } from 'react';
import { History, LockKeyhole, MessageCircle } from 'lucide-react';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useWorkspace, requestId } from '../social/workspace.ts';
import { Avatar, PostCard } from '../social/PostCard.tsx';
import { useT } from '../i18n/index.ts';
import { useIntl } from 'react-intl';
import { joinThreads, recap, bannerVariant } from './model.ts';
import type { ArchivedItem } from './model.ts';
import styles from '../social/Social.module.css';

export function Archive({ client }: { client: WorkspaceClient }) {
  const t = useT(),
    intl = useIntl();
  const { summary, revision, error: openError } = useWorkspace(client);
  const [accountKey, setAccountKey] = useState(
    client.summary?.review?.accountKey ??
      client.summary?.accounts[0]?.key ??
      '',
  );
  const [entries, setEntries] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [year, setYear] = useState('all');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [limit, setLimit] = useState(40);
  const sequence = useRef(0);
  const zone =
    summary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    if (!accountKey && summary?.accounts[0])
      setAccountKey(summary.accounts[0].key);
  }, [accountKey, summary]);
  useEffect(() => {
    if (!accountKey) return;
    const version = ++sequence.current;
    const queryId = requestId();
    setLoading(true);
    setError(false);
    setEntries([]);
    void (async () => {
      const query = await client.request({
        type: 'query',
        requestId: requestId(),
        queryId,
        generation: 1,
        accountKey,
        filter: {},
        sort: [{ by: 'createdAt', direction: 'desc' }],
        search: '',
      });
      if (query.type !== 'queryResult')
        throw new Error('Archive query rejected');
      const all: ArchivedItem[] = [];
      for (let offset = 0; offset < query.total; offset += 200) {
        if (version !== sequence.current) return;
        const window = await client.request({
          type: 'window',
          requestId: requestId(),
          queryId,
          generation: 1,
          offset,
          limit: 200,
        });
        if (window.type !== 'rows') throw new Error('Archive window rejected');
        for (let first = 0; first < window.rows.length; first += 16) {
          if (version !== sequence.current) return;
          const batch = await Promise.all(
            window.rows.slice(first, first + 16).map(async (row) => {
              const detail = await client.request({
                type: 'detail',
                requestId: requestId(),
                itemId: row.id,
              });
              if (detail.type !== 'itemDetail')
                throw new Error('Archive detail rejected');
              return { item: detail.item, outcome: row.outcome };
            }),
          );
          all.push(...batch);
        }
      }
      if (version === sequence.current) setEntries(all);
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
  }, [client, accountKey, revision]);
  const stats = useMemo(
    () => recap(entries, new Date(), zone),
    [entries, zone],
  );
  const groups = useMemo(() => joinThreads(entries), [entries]);
  const visible = groups.filter((group) =>
    group.some(({ item }) => {
      const inYear =
        year === 'all' ||
        intl.formatDate(item.createdAt, { year: 'numeric', timeZone: zone }) ===
          year;
      const inKind =
        kind === 'all' ||
        (kind === 'original' ? item.kind !== 'repost' : item.kind === kind);
      return (
        inYear &&
        inKind &&
        item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())
      );
    }),
  );
  const account = summary?.accounts.find((entry) => entry.key === accountKey);
  const deleted = entries.filter(
    ({ outcome }) => outcome === 'deleted-by-user',
  ).length;
  return (
    <section data-testid="archive">
      <div className={styles.layout}>
        <div className={styles.column}>
          <div className={styles.card}>
            <div
              className={styles.banner}
              data-testid="archive-banner"
              data-palette={bannerVariant(account?.handle ?? accountKey)}
              aria-hidden="true"
            />
            <div className={styles.profile}>
              <Avatar handle={account?.handle ?? null} large />
              <h2>{account?.handle ?? t('review.account')}</h2>
              <p>@{account?.handle ?? accountKey}</p>
              <div className={styles.profileCounts}>
                <span>
                  <strong>{intl.formatNumber(entries.length)}</strong>{' '}
                  {t('proto.archiveEntries')}
                </span>
                <span>
                  <strong>{intl.formatNumber(deleted)}</strong>{' '}
                  {t('proto.archiveDeleted')}
                </span>
                <span>
                  <LockKeyhole size={14} aria-hidden="true" />{' '}
                  {t('proto.onlyHere')}
                </span>
              </div>
            </div>
          </div>
          <div className={styles.controls}>
            <label className={styles.field}>
              {t('review.account')}
              <select
                value={accountKey}
                onChange={(e) => {
                  setAccountKey(e.target.value);
                  setYear('all');
                  setSearch('');
                  setLimit(40);
                }}
              >
                {summary?.accounts.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    @{entry.handle ?? entry.key}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              {t('proto.year')}
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setLimit(40);
                }}
              >
                <option value="all">{t('proto.allYears')}</option>
                {stats.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              {t('review.kindFilter')}
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setLimit(40);
                }}
              >
                <option value="all">{t('review.all')}</option>
                <option value="original">{t('proto.noReposts')}</option>
                <option value="reply">{t('review.templateReplies')}</option>
                <option value="repost">{t('review.templateReposts')}</option>
              </select>
            </label>
          </div>
          <label className={styles.field}>
            {t('proto.archiveSearch')}
            <input
              type="search"
              value={search}
              maxLength={4096}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(40);
              }}
              placeholder={t('proto.searchPlaceholder')}
            />
          </label>
          <div className={styles.timeline}>
            <div className={styles.timelineHeader}>
              <h2>{t('proto.timeline')}</h2>
              <span className={styles.hint}>{t('proto.newestFirst')}</span>
            </div>
            {loading && (
              <p className={styles.empty} role="status">
                {t('proto.archiveLoading')}
              </p>
            )}
            {!loading && !visible.length && (
              <p className={styles.empty}>{t('review.noResults')}</p>
            )}
            {visible.slice(0, limit).map((group) => (
              <div
                className={styles.thread}
                key={group[0]!.item.id}
                data-thread-size={group.length}
              >
                {group.length > 1 && (
                  <div className={styles.threadHeader}>
                    <MessageCircle size={16} aria-hidden="true" />
                    {t('proto.thread', { count: group.length })}
                  </div>
                )}
                {group.map(({ item, outcome }) => (
                  <PostCard
                    key={item.id}
                    item={item}
                    outcome={outcome}
                    threaded={group.length > 1}
                    zone={zone}
                  />
                ))}
              </div>
            ))}
            {!loading && visible.length > limit && (
              <div className={styles.empty}>
                <button onClick={() => setLimit((n) => n + 40)}>
                  {t('proto.loadMore')}
                </button>
              </div>
            )}
          </div>
          {(error || openError) && (
            <p className={styles.error} role="alert">
              {t('workspace.storageError')}
            </p>
          )}
        </div>
        <aside className={styles.side}>
          {!loading && entries.length > 0 && (
            <div className={styles.panel} data-testid="recap">
              <span className={styles.eyebrow}>{t('proto.timeCapsule')}</span>
              <h2 className={styles.recapTitle}>
                <History size={20} aria-hidden="true" />
                {t('proto.recapTitle')}
              </h2>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <strong>{t('proto.ageNumber', { count: stats.age })}</strong>
                  <span>{t('proto.oldestLabel')}</span>
                </div>
                <div className={styles.stat}>
                  <strong>{stats.year}</strong>
                  <span>
                    {t('proto.activeLabel', { count: stats.activeCount })}
                  </span>
                </div>
                <div className={styles.stat}>
                  <strong>
                    {stats.likes === null
                      ? t('proto.unknownCount')
                      : intl.formatNumber(stats.likes)}
                  </strong>
                  <span>{t('proto.mostLikes')}</span>
                </div>
                <div className={styles.stat}>
                  <strong>{intl.formatNumber(stats.lols)}</strong>
                  <span>{t('proto.lolCount')}</span>
                </div>
              </div>
            </div>
          )}
          <div className={styles.panel}>
            <h2>{t('proto.yearsHeading')}</h2>
            <div className={styles.yearLinks}>
              {stats.years.map((value) => (
                <button
                  key={value}
                  onClick={() => {
                    setYear(value);
                    setLimit(40);
                    window.scrollTo(0, 0);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.panel}>
            <h2>{t('proto.archiveStays')}</h2>
            <a href="#/backup">{t('workspace.backup')}</a>
          </div>
        </aside>
      </div>
    </section>
  );
}
