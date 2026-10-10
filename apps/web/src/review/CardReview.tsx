import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Trash2,
  Check,
  CheckCircle2,
  Pause,
  Undo2,
  Sparkles,
} from 'lucide-react';
import type { DecisionValue } from '@socialprune/core';
import type {
  BulkPreview,
  ItemDetail,
  QueryFilter,
  QuerySort,
  ReviewRow,
  WorkspaceReply,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import { PostCard } from '../social/PostCard.tsx';
import { useWorkspace, requestId } from '../social/workspace.ts';
import { categoryID, riskMessage } from './model.ts';
import { BulkDialog } from './BulkDialog.tsx';
import { deriveState } from '@socialprune/core/workspace/state';
import styles from '../social/Social.module.css';

const riskSort: QuerySort = [
  { by: 'risk', direction: 'desc' },
  { by: 'createdAt', direction: 'desc' },
];
type Counts = Extract<WorkspaceReply, { type: 'queryResult' }>['counts'];

export function CardReview({ client }: { client: WorkspaceClient }) {
  const t = useT();
  const { summary, revision, error: openError } = useWorkspace(client);
  const [accountKey, setAccountKey] = useState(
    client.summary?.review?.accountKey ??
      client.summary?.accounts[0]?.key ??
      '',
  );
  const [riskOnly, setRiskOnly] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [row, setRow] = useState<ReviewRow | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [replacement, setReplacement] = useState<'stale' | 'expired' | null>(
    null,
  );
  const query = useRef(requestId());
  const generation = useRef(0);
  const page = useRef(requestId());
  const previewId = useRef<string | null>(null);
  const previewVersion = useRef(0);
  const commandLock = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const focusAfter = useRef(false);
  const account = summary?.accounts.find((entry) => entry.key === accountKey);
  const zone =
    summary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (!accountKey && summary?.accounts[0])
      setAccountKey(summary.accounts[0].key);
  }, [summary, accountKey]);
  useEffect(() => {
    if (!accountKey) return;
    let active = true;
    const version = ++generation.current;
    setLoading(true);
    setDetail(null);
    setRow(null);
    const filter: QueryFilter = {
      decisions: ['undecided'],
      ...(riskOnly
        ? { risk: { min: 2, max: 3, unknown: 'exclude' as const } }
        : {}),
    };
    void (async () => {
      const progress = await client.request({
        type: 'query',
        requestId: requestId(),
        queryId: requestId(),
        generation: 1,
        accountKey,
        filter: {},
        sort: riskSort,
        search: '',
      });
      const result = await client.request({
        type: 'query',
        requestId: requestId(),
        queryId: query.current,
        generation: version,
        accountKey,
        filter,
        sort: riskSort,
        search: '',
      });
      if (!active || result.type !== 'queryResult') return;
      if (progress.type === 'queryResult') setCounts(progress.counts);
      setTotal(result.total);
      const offset = Math.min(position, Math.max(0, result.total - 1));
      const window = await client.request({
        type: 'window',
        requestId: requestId(),
        queryId: query.current,
        generation: version,
        offset,
        limit: 1,
      });
      if (!active || window.type !== 'rows') return;
      const next = window.rows[0];
      setRow(next ?? null);
      if (next) {
        const full = await client.request({
          type: 'detail',
          requestId: requestId(),
          itemId: next.id,
        });
        if (active && full.type === 'itemDetail') setDetail(full);
      }
    })()
      .catch(() => active && setError(true))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, accountKey, riskOnly, position, revision, refresh]);
  useEffect(() => {
    if (!loading && focusAfter.current) {
      card.current?.focus();
      focusAfter.current = false;
    }
  }, [loading]);
  useEffect(
    () => () => {
      previewVersion.current++;
      if (previewId.current)
        void client
          .request({
            type: 'releasePreview',
            requestId: requestId(),
            pageId: page.current,
            previewId: previewId.current,
          })
          .catch(() => undefined);
    },
    [client],
  );

  async function decide(value: DecisionValue) {
    if (!row || !detail || commandLock.current || loading) return;
    commandLock.current = true;
    setBusy(true);
    setError(false);
    try {
      const reply = await client.request({
        type: 'decide',
        requestId: requestId(),
        commandId: requestId(),
        itemIds: [row.id],
        value,
        expected: { [row.id]: row.decision },
      });
      if (reply.type !== 'committed') throw new Error('Decision rejected');
      setNotice(t('review.markNotice', { count: reply.changed }));
      focusAfter.current = true;
      setRefresh((n) => n + 1);
    } catch {
      setError(true);
    } finally {
      commandLock.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (commandLock.current) return;
    commandLock.current = true;
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
      setPosition(0);
      setRefresh((n) => n + 1);
      focusAfter.current = true;
    } catch {
      setError(true);
    } finally {
      commandLock.current = false;
      setBusy(false);
    }
  }
  function cancelBulk() {
    previewVersion.current++;
    if (previewId.current)
      void client
        .request({
          type: 'releasePreview',
          requestId: requestId(),
          pageId: page.current,
          previewId: previewId.current,
        })
        .catch(() => undefined);
    previewId.current = null;
    setBulkOpen(false);
    setPreview(null);
    setBulkLoading(false);
  }
  async function prepareBulk(
    includeKept = false,
    replace: 'stale' | 'expired' | null = null,
  ) {
    const version = ++previewVersion.current;
    setBulkOpen(true);
    setBulkLoading(true);
    setOverwrite(includeKept);
    setReplacement(replace);
    setError(false);
    try {
      if (previewId.current)
        await client.request({
          type: 'releasePreview',
          requestId: requestId(),
          pageId: page.current,
          previewId: previewId.current,
        });
      const nextQuery = requestId(),
        nextPreview = requestId();
      const filter: QueryFilter = {
        risk: { min: 2, max: 3, unknown: 'exclude' },
      };
      const result = await client.request({
        type: 'query',
        requestId: requestId(),
        queryId: nextQuery,
        generation: 1,
        accountKey,
        filter,
        sort: riskSort,
        search: '',
      });
      if (version !== previewVersion.current) return;
      if (result.type !== 'queryResult') throw new Error('Query rejected');
      previewId.current = nextPreview;
      const reply = await client.request({
        type: 'previewBulk',
        requestId: requestId(),
        pageId: page.current,
        previewId: nextPreview,
        queryId: nextQuery,
        generation: 1,
        value: 'delete',
        overwrite: includeKept
          ? ['undecided', 'later', 'keep', 'delete']
          : ['undecided', 'later'],
      });
      if (version !== previewVersion.current) {
        await client.request({
          type: 'releasePreview',
          requestId: requestId(),
          pageId: page.current,
          previewId: nextPreview,
        });
        return;
      }
      if (reply.type !== 'bulkPreview') throw new Error('Preview rejected');
      setPreview(reply);
    } catch {
      if (version === previewVersion.current) setError(true);
    } finally {
      if (version === previewVersion.current) setBulkLoading(false);
    }
  }
  async function confirmBulk() {
    if (!preview || commandLock.current || bulkLoading) return;
    commandLock.current = true;
    setBulkLoading(true);
    try {
      const result = await client.request({
        type: 'confirmBulk',
        requestId: requestId(),
        commandId: requestId(),
        pageId: page.current,
        previewId: preview.previewId,
      });
      if (result.type === 'committed') {
        setNotice(t('review.markNotice', { count: result.changed }));
        cancelBulk();
        setRefresh((n) => n + 1);
        setPosition(0);
      } else if (
        result.type === 'rejected' &&
        (result.code === 'STALE_PREVIEW' || result.code === 'PREVIEW_EXPIRED')
      ) {
        await prepareBulk(
          overwrite,
          result.code === 'STALE_PREVIEW' ? 'stale' : 'expired',
        );
      } else throw new Error('Bulk rejected');
    } catch {
      setError(true);
    } finally {
      commandLock.current = false;
      setBulkLoading(false);
    }
  }
  const current = detail
    ? deriveState({
        items: [detail.item],
        assessments: detail.assessments,
        decisionEvents: [],
        outcomeEvents: [],
      })
        .get(detail.item.id)
        ?.assessments.sort((a, b) => b.risk - a.risk)[0]
    : undefined;
  const source = current?.source;
  const sourceText = source
    ? source.kind === 'fixture'
      ? t('review.example')
      : source.kind === 'agent'
        ? t('review.agent', { name: source.name })
        : source.kind === 'model'
          ? t('review.modelSource', { name: source.name })
          : t('review.sourceRules')
    : '';
  const all = counts
    ? Object.values(counts.decisions).reduce((a, b) => a + b, 0)
    : 0;
  const completed = all - (counts?.decisions.undecided ?? 0);
  return (
    <section data-testid="card-review">
      <div className={styles.layout}>
        <div className={styles.column}>
          <div className={styles.controls}>
            <label className={styles.field}>
              {t('review.account')}
              <select
                value={accountKey}
                onChange={(e) => {
                  setAccountKey(e.target.value);
                  setPosition(0);
                  setNotice(null);
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
              {t('proto.reviewQueue')}
              <select
                value={riskOnly ? 'risk' : 'all'}
                onChange={(e) => {
                  setRiskOnly(e.target.value === 'risk');
                  setPosition(0);
                }}
              >
                <option value="all">{t('proto.unreviewed')}</option>
                <option value="risk">{t('proto.riskyOnly')}</option>
              </select>
            </label>
          </div>
          <div className={styles.progressLine}>
            <strong>
              {t('proto.progress', { count: completed, total: all })}
            </strong>
            <span>{t('proto.riskFirst')}</span>
          </div>
          <progress
            className={styles.progress}
            aria-label={t('review.title')}
            value={completed}
            max={Math.max(all, 1)}
          />
          <div
            ref={card}
            tabIndex={0}
            role="region"
            aria-label={t('proto.cardKeys')}
            data-testid="review-card"
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.repeat ||
                event.altKey ||
                event.metaKey ||
                event.ctrlKey ||
                bulkOpen ||
                localStorage.getItem('sp-single-keys') === 'off'
              )
                return;
              const key = event.key.toLowerCase();
              const action = ({ j: 'delete', k: 'keep', l: 'later' } as const)[
                key as 'j'
              ];
              if (action) {
                event.preventDefault();
                void decide(action);
              }
              if (key === 'u') {
                event.preventDefault();
                void undo();
              }
            }}
          >
            <div className={styles.card}>
              {detail && row ? (
                <>
                  <PostCard item={detail.item} zone={zone} />
                  <div className={styles.suggestion}>
                    {current ? (
                      <>
                        <div className={styles.suggestionHeader}>
                          <span
                            className={styles.chip}
                            data-risk={current.risk}
                          >
                            {t(riskMessage[current.risk] ?? 'review.riskNone')}
                          </span>
                          <strong>{t(categoryID(current.category))}</strong>
                          <span className={styles.source}>{sourceText}</span>
                        </div>
                        <p>{current.reason}</p>
                      </>
                    ) : (
                      <p>{t('review.noSuggestions')}</p>
                    )}
                  </div>
                </>
              ) : (
                <div className={styles.empty}>
                  {loading ? (
                    t('gate.preparing')
                  ) : (
                    <>
                      <CheckCircle2 size={36} aria-hidden="true" />
                      <h2>{t('proto.queueDone')}</h2>
                      <p>{t('proto.queueDoneBody')}</p>
                      <a href="#/archive">{t('proto.archiveTitle')}</a>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className={styles.decisions}>
              <button
                className={styles.keep}
                disabled={busy || loading || !detail}
                onClick={() => {
                  void decide('keep');
                }}
              >
                <Check size={20} aria-hidden="true" />
                {t('review.keep')}
                <kbd className={styles.key}>K</kbd>
              </button>
              <button
                className={styles.delete}
                aria-describedby="card-delete-help"
                disabled={busy || loading || !detail}
                onClick={() => {
                  void decide('delete');
                }}
              >
                <Trash2 size={20} aria-hidden="true" />
                {t('proto.delete')}
                <kbd className={styles.key}>J</kbd>
              </button>
              <button
                className={styles.quiet}
                disabled={busy || loading || !detail}
                onClick={() => {
                  void decide('later');
                }}
              >
                <Pause size={20} aria-hidden="true" />
                {t('review.later')}
                <kbd className={styles.key}>L</kbd>
              </button>
            </div>
          </div>
          <div className={styles.smallActions}>
            <button
              className={styles.textButton}
              disabled={busy}
              onClick={() => {
                void undo();
              }}
            >
              <Undo2 size={16} aria-hidden="true" />
              {t('review.undo')}
              <kbd className={styles.key}>U</kbd>
            </button>
            <span className={styles.hint}>
              {t('proto.remaining', { count: total })}
            </span>
            <div>
              <button
                className={styles.textButton}
                aria-label={t('proto.previousCard')}
                disabled={!position || loading}
                onClick={() => setPosition((n) => n - 1)}
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              <button
                className={styles.textButton}
                aria-label={t('proto.nextCard')}
                disabled={position + 1 >= total || loading}
                onClick={() => setPosition((n) => n + 1)}
              >
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p className={styles.hint}>
            {t('proto.cardKeysShort')}
            <span id="card-delete-help" className={styles.srOnly}>
              {t('proto.deleteHelp')}
            </span>
          </p>
          <p className={styles.notice} role="status">
            {notice ?? t('review.saved')}
          </p>
          {(error || openError) && (
            <p className={styles.error} role="alert">
              {t('workspace.storageError')}
            </p>
          )}
        </div>
        <aside className={styles.side}>
          <div className={styles.panel}>
            <h2>{t('proto.bulkHeading')}</h2>
            <button
              className={styles.primary}
              disabled={!accountKey || busy || loading}
              onClick={() => {
                void prepareBulk();
              }}
            >
              <Sparkles size={18} aria-hidden="true" />
              {t('bulk.markSuggested')}
            </button>
          </div>
          <div className={styles.panel}>
            <div className={styles.smallActions}>
              <a href="#/archive">{t('proto.archiveTitle')}</a>
            </div>
            <a
              href={
                accountKey.startsWith('instagram:')
                  ? '#/clicklist/instagram/go'
                  : '#/clicklist/x/go'
              }
            >
              {t('proto.goTitle')}
            </a>
          </div>
        </aside>
      </div>
      <BulkDialog
        open={bulkOpen}
        preview={preview}
        account={account?.handle ?? accountKey}
        filterDescription={t('bulk.suggestedFilter')}
        overwrite={overwrite}
        loading={bulkLoading}
        replacement={replacement}
        error={error ? t('workspace.storageError') : null}
        onOverwrite={(value) => {
          void prepareBulk(value);
        }}
        onConfirm={() => {
          void confirmBulk();
        }}
        onCancel={cancelBulk}
        renderSources={(entry) => (
          <span className={styles.source}>
            {entry.sources
              .map((source) =>
                source.kind === 'fixture'
                  ? t('review.example')
                  : source.kind === 'agent'
                    ? t('review.agent', { name: source.name })
                    : source.kind === 'model'
                      ? t('review.modelSource', { name: source.name })
                      : t('review.sourceRules'),
              )
              .join(', ')}
          </span>
        )}
      />
    </section>
  );
}
