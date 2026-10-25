import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DesktopBridge,
  DesktopScanSetup,
  DesktopScanPlan,
  DesktopScanView,
} from '@socialprune/core/workspace/desktop-protocol';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import { useT } from '../i18n/index.ts';
import { command } from './bridge.ts';
import { tokenMessage } from './messages.ts';
import styles from './Desktop.module.css';

export function Scan({
  bridge,
  summary,
  failed,
  onView,
}: {
  bridge: DesktopBridge;
  summary: WorkspaceSummary | null;
  failed: (error: unknown) => void;
  onView: (view: DesktopScanView) => void;
}) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [profile, setProfile] = useState<
    'openai-compatible' | 'llama-server' | 'ollama' | 'openrouter'
  >('openai-compatible');
  const [batch, setBatch] = useState('');
  const [keyFile, setKeyFile] = useState<string | null>(null);
  const [setup, setSetup] = useState<DesktopScanSetup | null>(null);
  const [plan, setPlan] = useState<DesktopScanPlan | null>(null);
  const [view, setView] = useState<DesktopScanView | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountKey, setAccountKey] = useState('');
  const lock = useRef(false);
  const accept = useCallback(
    (next: DesktopScanView) =>
      setView((previous) =>
        !previous || next.version >= previous.version ? next : previous,
      ),
    [],
  );
  useEffect(() => {
    if (view) onView(view);
  }, [view, onView]);
  useEffect(() => {
    let live = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const reply = await command(bridge, { type: 'scanView' });
        if (live && reply.type === 'scanView') accept(reply.view);
      } catch (error) {
        if (live) failed(error);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bridge, accept, failed]);
  useEffect(() => {
    setAccountKey((key) => key || summary?.accounts[0]?.key || '');
  }, [summary]);
  const invalidate = () => {
    setSetup(null);
    setPlan(null);
    setAgreed(false);
    setReviewed(false);
  };
  const working = view !== null && !['idle', 'ended'].includes(view.phase);
  const phases = {
    idle: 'scan.phase.idle',
    running: 'scan.phase.running',
    paused: 'scan.phase.paused',
    ending: 'scan.phase.ending',
    ended: 'scan.phase.ended',
  } as const;
  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      failed(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function check() {
    invalidate();
    const source = await command(bridge, {
      type: 'scanSource',
      baseUrl,
      model,
      profile,
      entriesPerRequest: Number(batch),
    });
    if (source.type !== 'scanSource') return;
    setSetup(source.setup);
    const checked = await command(bridge, { type: 'scanCheck' });
    if (checked.type !== 'scanCheck') return;
    setSetup(checked.setup);
    if (checked.setup.answeringModel && accountKey) {
      const preview = await command(bridge, { type: 'scanPlan', accountKey });
      if (preview.type === 'scanPlan') setPlan(preview.plan);
    }
  }
  async function start(resume: boolean) {
    if (!plan || !setup?.answeringModel || !agreed || (resume && !reviewed))
      return;
    const reply = await command(bridge, {
      type: 'scanStart',
      planHash: plan.planHash,
      origin: setup.origin,
      answeringModel: setup.answeringModel,
      agreed: true,
      resume,
    });
    if (reply.type === 'scanStart') accept(reply.view);
  }
  async function control(action: 'pause' | 'resume' | 'stop') {
    if (!view?.runId) return;
    const reply = await command(bridge, {
      type: 'scanAction',
      runId: view.runId,
      version: view.version,
      action,
    });
    if (reply.type === 'scanAction') accept(reply.view);
  }
  return (
    <section className={styles.scan} data-testid="desktop-scan">
      <p className={styles.lead}>{t('scan.intro')}</p>
      {!working && (
        <form
          className={styles.scanSurface}
          onSubmit={(event) => {
            event.preventDefault();
            void perform(check);
          }}
        >
          <fieldset disabled={busy} className={styles.scanForm}>
            <div className={styles.scanFields}>
              <label className={styles.field}>
                {t('scan.address')}
                <input
                  type="url"
                  value={baseUrl}
                  required
                  maxLength={4096}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label className={styles.field}>
                {t('scan.model')}
                <input
                  value={model}
                  required
                  maxLength={200}
                  onChange={(event) => {
                    setModel(event.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label className={styles.field}>
                {t('review.account')}
                <select
                  value={accountKey}
                  onChange={(event) => {
                    setAccountKey(event.target.value);
                    invalidate();
                  }}
                >
                  <option value="">
                    {t('desktop.token.ACCOUNT_REQUIRED')}
                  </option>
                  {summary?.accounts.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.handle ?? account.key}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                {t('scan.batch')}
                <input
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={batch}
                  aria-describedby="scan-batch-help"
                  onChange={(event) => {
                    setBatch(event.target.value);
                    invalidate();
                  }}
                />
              </label>
            </div>
            <p id="scan-batch-help" className={styles.scanHint}>
              {t('scan.batchHelp')}
            </p>
            <details>
              <summary>{t('scan.profile')}</summary>
              <label className={styles.field}>
                {t('scan.profile')}
                <select
                  value={profile}
                  onChange={(event) => {
                    setProfile(event.target.value as typeof profile);
                    invalidate();
                  }}
                >
                  {(
                    [
                      'openai-compatible',
                      'llama-server',
                      'ollama',
                      'openrouter',
                    ] as const
                  ).map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </details>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void perform(async () => {
                    const reply = await command(bridge, { type: 'scanKey' });
                    if (reply.type === 'scanKey') {
                      setKeyFile(reply.keyFile);
                      invalidate();
                    }
                  });
                }}
              >
                {t('scan.chooseKey')}
              </button>
              {keyFile && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void perform(async () => {
                      const reply = await command(bridge, {
                        type: 'scanKey',
                        clear: true,
                      });
                      if (reply.type === 'scanKey') {
                        setKeyFile(null);
                        invalidate();
                      }
                    });
                  }}
                >
                  {t('scan.clearKey')}
                </button>
              )}
              <span className={styles.scanHint}>
                {keyFile ? t('scan.key', { path: keyFile }) : t('scan.noKey')}
              </span>
            </div>
            <p className={styles.scanHint}>{t('scan.checkHelp')}</p>
            <button type="submit" disabled={busy || !accountKey}>
              {busy ? t('desktop.busy') : t('scan.check')}
            </button>
            {setup && (
              <div className={styles.scanAgreement}>
                <dl className={styles.scanFacts}>
                  <div>
                    <dt>{t('scan.origin')}</dt>
                    <dd>{setup.origin}</dd>
                  </div>
                  <div>
                    <dt>{t('scan.listed')}</dt>
                    <dd>
                      {setup.modelListed === null
                        ? t('desktop.unknown')
                        : t(setup.modelListed ? 'scan.yes' : 'scan.no')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('scan.answering')}</dt>
                    <dd>{setup.answeringModel ?? t('desktop.unknown')}</dd>
                  </div>
                </dl>
                <p>
                  {t(setup.local ? 'scan.share.local' : 'scan.share.remote', {
                    origin: setup.origin,
                    model: setup.answeringModel ?? setup.model,
                  })}
                </p>
                <p>{t('scan.terms', { origin: setup.origin })}</p>
                <p>{t('scan.contents')}</p>
                {plan && <p>{t('scan.plan', plan)}</p>}
                <p>{t('scan.canary')}</p>
                <label className={styles.tick}>
                  <input
                    type="checkbox"
                    checked={agreed}
                    disabled={busy || !plan}
                    onChange={(event) => setAgreed(event.target.checked)}
                  />
                  {t('scan.agree')}
                </label>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !agreed || !plan}
                  onClick={() => {
                    void perform(() => start(false));
                  }}
                >
                  {t('scan.start')}
                </button>
              </div>
            )}
          </fieldset>
        </form>
      )}
      {view && view.phase !== 'idle' && (
        <section
          className={styles.scanSurface}
          data-testid="scan-monitor"
          data-phase={view.phase}
        >
          <h2 role="status">{t(phases[view.phase])}</h2>
          <p>{t('scan.progress', view)}</p>
          <progress
            className={styles.progress}
            value={view.stored}
            max={Math.max(1, view.planned)}
            aria-label={t('scan.title')}
          />
          <p className={styles.scanHint}>{t('scan.requests', view)}</p>
          <p className={styles.scanHint}>
            {t('scan.tokens', {
              input: view.tokens.promptTokens?.toString() ?? t('scan.noUsage'),
              cached:
                view.tokens.cachedPromptTokens?.toString() ?? t('scan.noUsage'),
              output:
                view.tokens.completionTokens?.toString() ?? t('scan.noUsage'),
            })}
          </p>
          {view.limit !== null && <p>{t('scan.canary')}</p>}
          {view.pauseRequested && <p role="status">{t('scan.pausePending')}</p>}
          <div className={styles.actions}>
            {working && (
              <button
                className={styles.stop}
                onClick={() => {
                  void control('stop').catch(failed);
                }}
              >
                {t('desktop.stop')}
              </button>
            )}
            {view.phase === 'running' && (
              <button
                disabled={busy || view.pauseRequested}
                onClick={() => {
                  void perform(() => control('pause'));
                }}
              >
                {t('scan.pause')}
              </button>
            )}
            {view.phase === 'paused' && (
              <button
                disabled={busy}
                onClick={() => {
                  void perform(() => control('resume'));
                }}
              >
                {t('scan.resume')}
              </button>
            )}
          </div>
          {view.stopCode && (
            <p role="status">{t(tokenMessage(view.stopCode))}</p>
          )}
          {view.phase === 'ended' && view.canResume && plan && (
            <div className={styles.scanAgreement}>
              <label className={styles.tick}>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                {t('scan.reviewed')}
              </label>
              <button
                className={styles.primary}
                disabled={busy || !reviewed || !agreed}
                onClick={() => {
                  void perform(() => start(true));
                }}
              >
                {t('scan.continue')}
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
