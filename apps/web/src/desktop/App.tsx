import '../styles/tokens.css';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { IntlProvider } from 'react-intl';
import type {
  DesktopBridge,
  DesktopBrowser,
  DesktopRunMode,
  DesktopRunPlan,
  RunView,
  DesktopScanView,
} from '@socialprune/core/workspace/desktop-protocol';
import { DesktopReplySchema } from '@socialprune/core/workspace/desktop-protocol';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import { catalogs, initialLocale, useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { LocalReviewClient } from '../local-review/client.ts';
import { BridgeWorkspacePort } from './bridge-port.ts';
import { BridgeError, command, subscribeRunView } from './bridge.ts';
import { installDesktopLinks } from './links.ts';
import { DesktopGuide, Setup } from './Setup.tsx';
import { DesktopSettings } from './Settings.tsx';
import { Monitor } from './Monitor.tsx';
import { Scan } from './Scan.tsx';
import styles from './Desktop.module.css';
import { browserMessages, modeMessages, tokenMessage } from './messages.ts';

const CardReview = lazy(() =>
  import('../review/CardReview.tsx').then((module) => ({
    default: module.CardReview,
  })),
);
const Review = lazy(() =>
  import('../review/Review.tsx').then((module) => ({ default: module.Review })),
);
const Archive = lazy(() =>
  import('../archive/Archive.tsx').then((module) => ({
    default: module.Archive,
  })),
);
const ClickList = lazy(() =>
  import('../clicklist/ClickList.tsx').then((module) => ({
    default: module.ClickList,
  })),
);
const DeleteMode = lazy(() =>
  import('../clicklist/DeleteMode.tsx').then((module) => ({
    default: module.DeleteMode,
  })),
);

type Screen =
  | 'scan'
  | 'setup'
  | 'review'
  | 'archive'
  | 'clicklist'
  | 'monitor'
  | 'settings'
  | 'guide';

function Content({
  bridge,
  locale,
  changeLocale,
}: {
  bridge: DesktopBridge;
  locale: Locale;
  changeLocale: (locale: Locale) => void;
}) {
  const t = useT();
  const [screen, setScreen] = useState<Screen>('setup');
  const [hash, setHash] = useState(location.hash);
  const [browser, setBrowser] = useState<DesktopBrowser>('edge');
  const [client] = useState(
    () => new LocalReviewClient(new BridgeWorkspacePort(bridge)),
  );
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [view, setView] = useState<RunView>({ phase: 'idle', version: 0 });
  const [scanView, setScanView] = useState<DesktopScanView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [accountKey, setAccountKey] = useState('');
  const [mode, setMode] = useState<DesktopRunMode>('fill');
  const [handle, setHandle] = useState('');
  const [plan, setPlan] = useState<DesktopRunPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [installedBrowsers, setInstalledBrowsers] = useState<DesktopBrowser[]>(
    [],
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const failed = useCallback(
    (error: unknown) =>
      setError(
        error instanceof BridgeError
          ? error
          : new Error('Invalid desktop reply.'),
      ),
    [],
  );
  const acceptView = useCallback(
    (next: RunView) =>
      setView((previous) => {
        const sameRun =
          previous.phase === 'idle' ||
          next.phase === 'idle' ||
          previous.runId === next.runId;
        return sameRun && next.version < previous.version ? previous : next;
      }),
    [],
  );
  useEffect(() => {
    const removeLinks = installDesktopLinks(bridge, failed);
    const unsubscribe = subscribeRunView(bridge, acceptView, () =>
      failed(new Error('Invalid run view.')),
    );
    void command(bridge, { type: 'runView' })
      .then((reply) => {
        if (reply.type === 'runView') {
          acceptView(reply.view);
          if (reply.view.phase !== 'idle') setScreen('monitor');
        }
      })
      .catch(failed);
    const stopSummary = client.subscribeSummary((value) => {
      setSummary(value);
      setAccountKey((key) => key || value?.accounts[0]?.key || '');
    });
    let active = true;
    void client
      .open()
      .then((reply) => {
        if (!active || reply.type !== 'opened' || !reply.summary.counts.items)
          return;
        setScreen((screen) => (screen === 'setup' ? 'review' : screen));
        void command(bridge, { type: 'browsers' })
          .then((reply) => {
            if (active && reply.type === 'browsersFound') {
              setInstalledBrowsers(reply.browsers);
              setBrowser(
                reply.browsers.includes('edge')
                  ? 'edge'
                  : (reply.browsers[0] ?? 'edge'),
              );
            }
          })
          .catch(failed);
      })
      .catch(failed);
    const stopChanges = client.subscribe((notice) => {
      if (notice.type === 'changed') void client.open().catch(failed);
    });
    window.workspace = client;
    return () => {
      active = false;
      removeLinks();
      unsubscribe();
      stopSummary();
      stopChanges();
      client.dispose();
      if (window.workspace === client)
        Reflect.deleteProperty(window, 'workspace');
    };
  }, [bridge, client, acceptView, failed]);
  useEffect(() => {
    const changed = () => {
      const value = location.hash;
      setHash(value);
      if (value.startsWith('#/review')) setScreen('review');
      else if (value.startsWith('#/archive')) setScreen('archive');
      else if (value.startsWith('#/clicklist')) setScreen('clicklist');
      else if (value === '#/backup' || value === '#/settings')
        setScreen('settings');
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [screen]);
  const imported = useCallback(() => {
    void client
      .open()
      .then(() => {
        location.hash = '#/review';
        setScreen('review');
      })
      .catch(failed);
  }, [client, failed]);
  useEffect(() => {
    const dropped = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string')
        return;
      try {
        const parsed = DesktopReplySchema.safeParse(JSON.parse(event.detail));
        if (!parsed.success) return;
        if (parsed.data.type === 'desktopFailed')
          failed(new BridgeError(parsed.data.code));
        else if (
          parsed.data.type === 'exportImported' &&
          parsed.data.result.status === 'imported'
        )
          imported();
      } catch {
        /* A forged page event cannot select or import a file. */
      }
    };
    window.addEventListener('socialprune:import-dropped', dropped);
    return () =>
      window.removeEventListener('socialprune:import-dropped', dropped);
  }, [failed, imported]);
  useEffect(() => {
    if (view.phase === 'ended') void client.open().catch(failed);
  }, [view.phase, client, failed]);
  useEffect(() => {
    if (scanView?.phase === 'ended') void client.open().catch(failed);
  }, [scanView?.phase, client, failed]);
  const activeAccount = summary?.accounts.find(
    (account) => account.key === accountKey,
  );
  function runFailed(error: unknown) {
    if (error instanceof BridgeError && error.code === 'WORKSPACE_BUSY')
      setError('previous-browser-open');
    else failed(error);
  }
  async function preview() {
    if (!activeAccount) return;
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const platform = accountKey.startsWith('instagram:') ? 'instagram' : 'x';
      const reply = await command(bridge, {
        type: 'planRun',
        platform,
        mode:
          platform === 'instagram'
            ? 'context'
            : mode === 'context'
              ? 'fill'
              : mode,
        accountKey,
        ...(handle ? { handle } : {}),
      });
      if (reply.type === 'runPlanned') setPlan(reply.plan);
    } catch (error) {
      runFailed(error);
    } finally {
      setBusy(false);
    }
  }
  async function prepareRun() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await command(bridge, {
        type: 'startRun',
        planHash: plan.planHash,
        browser,
      });
      if (reply.type === 'runStarted') {
        acceptView(reply.view);
        setScreen('monitor');
      }
    } catch (error) {
      runFailed(error);
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    setup: 'desktop.setup',
    review: 'review.title',
    archive: 'proto.archiveTitle',
    clicklist: 'clicklist.title',
    monitor: 'desktop.monitor',
    scan: 'scan.title',
    settings: 'desktop.data',
    guide: 'nav.guide',
  } as const;
  return (
    <CSPProvider disableStyleElements>
      <div className={styles.shell}>
        <a
          className={styles.skip}
          href="#main"
          onClick={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
        >
          {t('nav.skip')}
        </a>
        <header className={styles.header}>
          <strong>{t('app.name')}</strong>
          <label className={styles.field}>
            {t('settings.language')}
            <select
              value={locale}
              onChange={(event) => changeLocale(event.target.value as Locale)}
            >
              <option value="en">{t('desktop.language.en')}</option>
              <option value="de">{t('desktop.language.de')}</option>
            </select>
          </label>
        </header>
        <nav className={styles.navigation} aria-label={t('app.name')}>
          {(Object.keys(titles) as Screen[]).map((value) => (
            <button
              key={value}
              aria-current={screen === value ? 'page' : undefined}
              onClick={() => {
                void client.flushCommands().then(() => {
                  setScreen(value);
                  setError(null);
                  if (
                    value === 'review' ||
                    value === 'archive' ||
                    value === 'clicklist'
                  ) {
                    location.hash =
                      value === 'clicklist' ? '#/clicklist/x' : `#/${value}`;
                    void client.open().catch(failed);
                  }
                });
              }}
            >
              {t(titles[value])}
            </button>
          ))}
        </nav>
        {screen !== 'monitor' &&
          view.phase !== 'idle' &&
          view.phase !== 'ended' && (
            <div className={styles.controls}>
              <button
                className={styles.stop}
                onClick={() => {
                  void command(bridge, {
                    type: 'runAction',
                    runId: view.runId,
                    version: view.version,
                    action: 'stop',
                  })
                    .then((reply) => {
                      if (reply.type === 'runActionResult')
                        acceptView(reply.view);
                    })
                    .catch(failed);
                }}
              >
                {t('desktop.stop')}
              </button>
              <button onClick={() => setScreen('monitor')}>
                {t('desktop.openMonitor')}
              </button>
            </div>
          )}
        {screen !== 'scan' &&
          scanView?.runId &&
          !['idle', 'ended'].includes(scanView.phase) && (
            <div className={styles.controls}>
              <button
                className={styles.stop}
                onClick={() => {
                  void command(bridge, {
                    type: 'scanAction',
                    runId: scanView.runId!,
                    version: scanView.version,
                    action: 'stop',
                  })
                    .then((reply) => {
                      if (reply.type === 'scanAction') setScanView(reply.view);
                    })
                    .catch(failed);
                }}
              >
                {t('desktop.stop')}
              </button>
              <button onClick={() => setScreen('scan')}>
                {t('scan.title')}
              </button>
            </div>
          )}
        <main
          id="main"
          className={
            screen === 'review' && hash !== '#/review/list'
              ? styles.reviewMain
              : undefined
          }
        >
          <h1 tabIndex={-1} ref={heading}>
            {t(titles[screen])}
          </h1>
          {error !== null && (
            <p role="alert" className={styles.error}>
              {error === 'previous-browser-open'
                ? t('desktop.previousBrowserOpen')
                : error instanceof BridgeError
                  ? t(tokenMessage(error.code))
                  : t('desktop.invalidReply')}
            </p>
          )}
          {screen === 'setup' && (
            <Setup
              bridge={bridge}
              locale={locale}
              changeLocale={changeLocale}
              browser={browser}
              changeBrowser={(value) => {
                setBrowser(value);
                setInstalledBrowsers((browsers) =>
                  browsers.includes(value) ? browsers : [...browsers, value],
                );
              }}
              imported={imported}
              failed={failed}
            />
          )}
          {screen === 'guide' && (
            <DesktopGuide bridge={bridge} locale={locale} failed={failed} />
          )}
          {screen === 'settings' && (
            <DesktopSettings
              bridge={bridge}
              restored={imported}
              failed={failed}
            />
          )}
          <div hidden={screen !== 'scan'}>
            <Scan
              bridge={bridge}
              summary={summary}
              failed={failed}
              onView={setScanView}
            />
          </div>
          {screen === 'monitor' && (
            <>
              {(view.phase === 'idle' || view.phase === 'ended') && (
                <section className={styles.panel}>
                  <label className={styles.field}>
                    {t('review.account')}
                    <select
                      value={accountKey}
                      onChange={(event) => {
                        setAccountKey(event.target.value);
                        setPlan(null);
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
                    {t('desktop.browser')}
                    <select
                      value={browser}
                      onFocus={() => {
                        void command(bridge, { type: 'browsers' })
                          .then((reply) => {
                            if (reply.type === 'browsersFound')
                              setInstalledBrowsers(reply.browsers);
                          })
                          .catch(failed);
                      }}
                      onChange={(event) => {
                        setBrowser(event.target.value as DesktopBrowser);
                        setPlan(null);
                      }}
                    >
                      {(installedBrowsers.length
                        ? installedBrowsers
                        : [browser]
                      ).map((value) => (
                        <option key={value} value={value}>
                          {t(browserMessages[value])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    {t('desktop.mode')}
                    <select
                      value={
                        accountKey.startsWith('instagram:') ? 'context' : mode
                      }
                      onChange={(event) => {
                        setMode(event.target.value as DesktopRunMode);
                        setPlan(null);
                      }}
                    >
                      {(accountKey.startsWith('instagram:')
                        ? (['context'] as const)
                        : (['fill', 'delete', 'verify'] as const)
                      ).map((value) => (
                        <option key={value} value={value}>
                          {t(modeMessages[value])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    {t('desktop.handle')}
                    <input
                      value={handle}
                      maxLength={30}
                      onChange={(event) => {
                        setHandle(event.target.value);
                        setPlan(null);
                      }}
                    />
                  </label>
                  <button
                    disabled={busy || !activeAccount}
                    onClick={() => {
                      void preview();
                    }}
                  >
                    {t('desktop.plan')}
                  </button>
                  {plan && (
                    <>
                      <p>
                        {t('desktop.planCount', {
                          count: plan.planned,
                          minutes: Math.ceil(plan.estimateMs / 60000),
                        })}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() => {
                          void prepareRun();
                        }}
                      >
                        {t('desktop.openMonitor')}
                      </button>
                    </>
                  )}
                </section>
              )}
              <Monitor
                bridge={bridge}
                view={view}
                acceptView={acceptView}
                failed={failed}
              />
            </>
          )}
          <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
            {screen === 'review' &&
              (hash === '#/review/list' ? (
                <Review client={client} />
              ) : (
                <CardReview client={client} />
              ))}
            {screen === 'archive' && <Archive client={client} />}
            {screen === 'clicklist' &&
              (hash.endsWith('/go') ? (
                <DeleteMode
                  client={client}
                  platform={hash.includes('/instagram') ? 'instagram' : 'x'}
                />
              ) : (
                <ClickList
                  client={client}
                  platform={hash.includes('/instagram') ? 'instagram' : 'x'}
                />
              ))}
          </Suspense>
        </main>
      </div>
    </CSPProvider>
  );
}

export function DesktopApp({ bridge }: { bridge: DesktopBridge }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <IntlProvider locale={locale} messages={catalogs[locale]}>
      <Content
        bridge={bridge}
        locale={locale}
        changeLocale={(value) => {
          setLocale(value);
          document.documentElement.lang = value;
          try {
            localStorage.setItem('sp-locale', value);
          } catch {
            /* Preferences are optional. */
          }
        }}
      />
    </IntlProvider>
  );
}
