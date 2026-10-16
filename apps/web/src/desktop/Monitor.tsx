import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import type {
  DesktopBridge,
  DesktopRunAction,
  RunView,
} from '@socialprune/core/workspace/desktop-protocol';
import { useT } from '../i18n/index.ts';
import { command } from './bridge.ts';
import styles from './Desktop.module.css';
import {
  phaseMessages,
  tokenMessage,
  unitMessages,
  warningMessages,
} from './messages.ts';

function secondsLeft(deadline: string | null, now: number) {
  return deadline
    ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000))
    : 0;
}

export function Monitor({
  bridge,
  view,
  acceptView,
  failed,
}: {
  bridge: DesktopBridge;
  view: RunView;
  acceptView: (view: RunView) => void;
  failed: (error: unknown) => void;
}) {
  const t = useT(),
    intl = useIntl();
  const [now, setNow] = useState(Date.now);
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stopRequested = useRef<string | null>(null);
  const runId = view.phase === 'idle' ? null : view.runId;
  useEffect(() => {
    setTick(false);
    stopRequested.current = null;
  }, [runId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function action(value: DesktopRunAction) {
    if (view.phase === 'idle' || (lock.current && value !== 'stop')) return;
    if (value === 'start' && !tick && !view.warning?.acknowledged) return;
    if (value === 'stop') stopRequested.current = view.runId;
    lock.current = true;
    setBusy(true);
    try {
      let version = view.version;
      if (value === 'start' && !view.warning?.acknowledged) {
        const acknowledged = await command(bridge, {
          type: 'runAction',
          runId: view.runId,
          version,
          action: 'acknowledge-warning',
        });
        if (
          acknowledged.type !== 'runActionResult' ||
          acknowledged.view.phase !== 'awaiting-start' ||
          acknowledged.view.runId !== view.runId ||
          !acknowledged.view.warning.acknowledged
        )
          throw new Error('Warning acknowledgement required.');
        version = acknowledged.view.version;
        acceptView(acknowledged.view);
      }
      if (value !== 'stop' && stopRequested.current === view.runId) return;
      const reply = await command(bridge, {
        type: 'runAction',
        runId: view.runId,
        version,
        action: value,
      });
      if (reply.type === 'runActionResult') acceptView(reply.view);
    } catch (error) {
      failed(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const waitDeadline =
    view.phase === 'batch-pause' || view.phase === 'reload-wait'
      ? view.until
      : view.phase === 'rate-wait'
        ? view.resetAt
        : null;
  const waitSeconds = waitDeadline
    ? Math.min(
        Math.ceil(('remainingMs' in view ? view.remainingMs : 0) / 1000),
        secondsLeft(waitDeadline, now),
      )
    : 0;
  const phaseSentence =
    view.phase === 'batch-pause' ||
    view.phase === 'rate-wait' ||
    view.phase === 'reload-wait'
      ? t(phaseMessages[view.phase], { seconds: waitSeconds })
      : t(phaseMessages[view.phase]);
  const active = view.phase !== 'idle' ? view : null;
  const warning = active?.warning;
  const ending =
    view.phase === 'ended' || view.phase === 'ending' ? view.end : null;
  const readback = active?.profile.readback;
  const listText = (values: readonly string[]) =>
    values.join(', ') || t('desktop.none');
  const stamp = (value: string) =>
    intl.formatDate(value, { dateStyle: 'medium', timeStyle: 'medium' });
  return (
    <section data-testid="desktop-monitor" data-phase={view.phase}>
      <div className={styles.controls}>
        {view.phase !== 'idle' && view.phase !== 'ended' && (
          <button
            className={styles.stop}
            onClick={() => {
              void action('stop');
            }}
          >
            {t('desktop.stop')}
          </button>
        )}
        {active && view.phase === 'paused' ? (
          <button
            disabled={busy}
            onClick={() => {
              void action('resume');
            }}
          >
            {t('desktop.resume')}
          </button>
        ) : (
          active &&
          [
            'running',
            'batch-pause',
            'rate-wait',
            'reload-wait',
            'awaiting-continue',
          ].includes(view.phase) && (
            <button
              disabled={busy || active.pauseRequested}
              onClick={() => {
                void action('pause');
              }}
            >
              {t('desktop.pause')}
            </button>
          )
        )}
      </div>
      <p
        className={styles.status}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {phaseSentence}
      </p>
      {active?.pauseRequested && view.phase !== 'paused' && (
        <p data-testid="pause-pending">{t('desktop.pausePending')}</p>
      )}
      {active && (
        <>
          <div className={styles.panel}>
            <p>{t('desktop.progress', active.progress)}</p>
            <progress
              className={styles.progress}
              aria-label={t('desktop.monitor')}
              value={active.progress.completed}
              max={Math.max(1, active.progress.planned)}
            />
            <p>
              {t('desktop.today', {
                used: active.today.used,
                cap: active.today.cap,
                unit: t(unitMessages[active.today.unit]),
                zone: active.today.timeZone,
              })}
            </p>
            <p>
              {t(
                active.today.sharedWithXDeleteAndFill
                  ? 'desktop.sharedCap'
                  : 'desktop.instagramCap',
              )}
            </p>
            {active.nextStepAt && (
              <p data-testid="next-step">
                {t('desktop.nextStep', {
                  seconds: secondsLeft(active.nextStepAt, now),
                })}
              </p>
            )}
            {active.browserWindow && (
              <p>
                {t(
                  active.browserWindow.placement === 'beside'
                    ? 'desktop.browserBeside'
                    : 'desktop.browserOwnSize',
                )}
              </p>
            )}
          </div>
          {warning &&
            ['awaiting-warning', 'awaiting-start'].includes(view.phase) && (
              <section
                className={styles.panel}
                aria-labelledby="warning-heading"
              >
                <h2 id="warning-heading">{t('desktop.warningTitle')}</h2>
                <p>{t(warningMessages[warning.form])}</p>
                {active.expectedHandle && (
                  <p>
                    {t('desktop.profileCapability', {
                      handle: active.expectedHandle,
                    })}
                  </p>
                )}
                <ul>
                  {active.profile.canChange.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p>{t('desktop.warningStop')}</p>
                <label className={styles.tick}>
                  <input
                    type="checkbox"
                    checked={tick || warning.acknowledged}
                    disabled={busy || warning.acknowledged}
                    onChange={(event) => setTick(event.target.checked)}
                  />
                  {t('desktop.warningTick')}
                </label>
                <button
                  className={styles.primary}
                  disabled={busy || (!tick && !warning.acknowledged)}
                  onClick={() => {
                    void action('start');
                  }}
                >
                  {t('desktop.start')}
                </button>
              </section>
            )}
          {view.phase === 'awaiting-continue' && (
            <button
              disabled={busy}
              onClick={() => {
                void action('continue');
              }}
            >
              {t('desktop.next')}
            </button>
          )}
          {view.phase === 'canary-review' && (
            <div className={styles.actions}>
              <button
                disabled={busy}
                onClick={() => {
                  void action('matches');
                }}
              >
                {t('desktop.matches')}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  void action('does-not-match');
                }}
              >
                {t('desktop.doesNotMatch')}
              </button>
            </div>
          )}
          {active.currentEntry && (
            <section className={styles.panel} aria-labelledby="entry-heading">
              <h2 id="entry-heading">{t('desktop.currentEntry')}</h2>
              <p>
                {t(`review.${active.currentEntry.kind}`)} ·{' '}
                <time dateTime={active.currentEntry.date}>
                  {stamp(active.currentEntry.date)}
                </time>
              </p>
              <p>{active.currentEntry.firstLine}</p>
              {active.currentEntry.textTruncated && (
                <p>{t('desktop.truncated')}</p>
              )}
              <p>{t(tokenMessage(active.currentEntry.action))}</p>
            </section>
          )}
          {ending && (
            <section
              className={styles.panel}
              aria-label={t('desktop.phase.ended')}
            >
              <p data-testid="run-end">
                {t(tokenMessage(ending.detail ?? ending.reason))}
              </p>
              {view.phase === 'ended' && <p>{t('desktop.endedBrowserOpen')}</p>}
            </section>
          )}
          <section className={styles.panel} aria-labelledby="journal-heading">
            <h2 id="journal-heading">{t('desktop.journal')}</h2>
            {active.journal.length ? (
              <ol className={styles.journal}>
                {active.journal.slice(-10).map((line, index) => (
                  <li key={`${line.at}-${index}`}>
                    <time dateTime={line.at}>{stamp(line.at)}</time>{' '}
                    {t(tokenMessage(line.action))}{' '}
                    {t(tokenMessage(line.outcome))}{' '}
                    {line.code && t(tokenMessage(line.code))}
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t('desktop.noJournal')}</p>
            )}
          </section>
          {active.xWindows.length > 0 && (
            <div className={`${styles.panel} ${styles.scroll}`}>
              <table className={styles.table}>
                <caption>{t('desktop.xWindows')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('desktop.operation')}</th>
                    <th scope="col">{t('desktop.limit')}</th>
                    <th scope="col">{t('desktop.remaining')}</th>
                    <th scope="col">{t('desktop.reset')}</th>
                  </tr>
                </thead>
                <tbody>
                  {active.xWindows.map((window) => (
                    <tr
                      key={`${window.operation}-${window.operationName ?? ''}`}
                    >
                      <th scope="row">
                        {window.operationName ?? window.operation}
                      </th>
                      <td>{window.limit}</td>
                      <td>{window.remaining}</td>
                      <td>
                        <time dateTime={window.resetAt}>
                          {stamp(window.resetAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {active.instagram && (
            <section
              className={styles.panel}
              aria-labelledby="responses-heading"
            >
              <h2 id="responses-heading">{t('desktop.instagramResponses')}</h2>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <caption>{t('desktop.instagramResponses')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('desktop.responseGroup')}</th>
                      <th scope="col">{t('desktop.responseCount')}</th>
                      <th scope="col">{t('desktop.clientErrors')}</th>
                      <th scope="col">{t('desktop.serverErrors')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.instagram.responses.map((group) => (
                      <tr key={`${group.host}-${group.path}`}>
                        <th scope="row">
                          {group.host} / {group.path}
                        </th>
                        <td>{group.count}</td>
                        <td>
                          {Object.entries(group.status4xx)
                            .map(([code, count]) => `${code}: ${count}`)
                            .join(', ') || t('desktop.none')}
                        </td>
                        <td>{group.status5xx}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>{t('desktop.headerNames')}</h3>
              <p>{listText(active.instagram.headerNames)}</p>
              {(['list', 'post'] as const).map((kind) => (
                <p key={kind}>
                  {t('desktop.readiness', {
                    kind: t(
                      kind === 'list'
                        ? 'desktop.listReady'
                        : 'desktop.postReady',
                    ),
                    count: active.instagram!.ready[kind].count,
                    median:
                      active.instagram!.ready[kind].medianMs?.toString() ??
                      t('desktop.unknown'),
                    max:
                      active.instagram!.ready[kind].maxMs?.toString() ??
                      t('desktop.unknown'),
                  })}
                </p>
              ))}
            </section>
          )}
          <section className={styles.panel} aria-labelledby="profile-heading">
            <h2 id="profile-heading">{t('desktop.profileChanges')}</h2>
            <ul>
              {active.profile.canChange.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {active.profile.before && (
              <>
                <p>
                  {t('desktop.profileBefore', {
                    account:
                      active.profile.before.account ?? t('desktop.unknown'),
                    extensions: listText(active.profile.before.extensionIds),
                  })}
                </p>
              </>
            )}
            {readback && (
              <>
                <h3>{t('desktop.readback')}</h3>
                <p data-testid="readback-outcome">
                  {t(tokenMessage(readback.outcome))}
                </p>
                <p>
                  {t('desktop.readbackAccounts', {
                    before: readback.accountBefore ?? t('desktop.unknown'),
                    after: readback.accountAfter ?? t('desktop.unknown'),
                  })}
                </p>
                <p>
                  {t('desktop.extensions', {
                    before: listText(readback.extensionIdsBefore),
                    after: listText(readback.extensionIdsAfter),
                    added: listText(readback.extensionIdsAdded),
                    removed: listText(readback.extensionIdsRemoved),
                  })}
                </p>
                <h4>{t('desktop.changedFiles')}</h4>
                <ul>
                  {readback.changedFiles.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
                <h4>{t('desktop.unexpectedRequests')}</h4>
                <ul>
                  {readback.unexpectedRequests.map((request, index) => (
                    <li key={index}>
                      {request.method} {request.host} {request.path}{' '}
                      {request.status} {request.operation}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}
