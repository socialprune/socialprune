import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { IntlProvider } from 'react-intl';
import importWorkerURL from '../import/worker.ts?worker&url';
import workspaceWorkerURL from '../workspace/worker.ts?worker&url';
import { WorkspaceClient } from '../workspace/client.ts';
import { ImportClient } from '../import/client.ts';
import type { ImportSnapshot } from '../import/client.ts';
import { catalogs, initialLocale, useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { WorkerGate } from './gate.ts';
import type { GateState } from './gate.ts';
import { scriptURL } from './trusted-urls.ts';
import { parseRoute } from './router.ts';
import { AppUpdates } from './updates.ts';
import { Guide } from '../guide/Guide.tsx';
import { DemoSession } from './demo.ts';
import styles from './Shell.module.css';
const Review = lazy(() =>
  import('../review/Review.tsx').then((module) => ({ default: module.Review })),
);
const ClickList = lazy(() =>
  import('../clicklist/ClickList.tsx').then((module) => ({
    default: module.ClickList,
  })),
);
const Backup = lazy(() =>
  import('../backup/Backup.tsx').then((module) => ({ default: module.Backup })),
);
const Settings = lazy(() =>
  import('../settings/Settings.tsx').then((module) => ({
    default: module.Settings,
  })),
);

function Content({
  locale,
  changeLocale,
}: {
  locale: Locale;
  changeLocale: (locale: Locale) => void;
}) {
  const t = useT();
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [gate] = useState(() => new WorkerGate());
  const [gateState, setGateState] = useState<GateState>(gate.state);
  const [state, setState] = useState<ImportSnapshot | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [reviewClient, setReviewClient] = useState<WorkspaceClient | null>(
    null,
  );
  const [hasWorkspaceItems, setHasWorkspaceItems] = useState(false);
  const [workspaceKind, setWorkspaceKind] = useState<'personal' | 'demo'>(
    'personal',
  );
  const [demoActive, setDemoActive] = useState(() => {
    if (route === '/demo') return true;
    if (route === '/' || route === '/import') return false;
    try {
      return sessionStorage.getItem('sp-demo-active') === 'true';
    } catch {
      return false;
    }
  });
  const [demoClient, setDemoClient] = useState<WorkspaceClient | null>(null);
  const [demoPhase, setDemoPhase] = useState<'opening' | 'ready' | 'error'>(
    'opening',
  );
  const [demoSnapshot, setDemoSnapshot] = useState<ImportSnapshot | null>(null);
  const [demoResetDone, setDemoResetDone] = useState(false);
  const demo = useRef<DemoSession | null>(null);
  const client = useRef<ImportClient | null>(null);
  const workspace = useRef<WorkspaceClient | null>(null);
  const updates = useRef<AppUpdates | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    const changed = () => {
      const next = parseRoute(location.hash);
      setRoute(next);
      if (next === '/demo') setDemoActive(true);
      else if (next === '/' || next === '/import') setDemoActive(false);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    const unsubscribe = gate.subscribe(setGateState);
    const updater = new AppUpdates(async () => {
      const current = client.current;
      if (current?.snapshot.phase === 'importing') current.abort();
      if (current?.snapshot.phase === 'aborting') {
        await new Promise<void>((resolve) => {
          const stop = current.subscribe((snapshot) => {
            if (
              snapshot.phase !== 'aborting' &&
              snapshot.phase !== 'importing'
            ) {
              stop();
              resolve();
            }
          });
        });
      }
      await workspace.current?.flushCommands();
    });
    updates.current = updater;
    const stopUpdates = updater.subscribe(setUpdateReady);
    navigator.serviceWorker?.addEventListener(
      'message',
      updater.handleServiceWorkerMessages,
    );
    void gate.ensure().then(async () => {
      if (gate.serviceWorkerRegistration)
        updater.watch(gate.serviceWorkerRegistration);
      if (gate.state !== 'ready') return;
      const working = new WorkspaceClient(
        new Worker(scriptURL(workspaceWorkerURL), { type: 'module' }),
      );
      workspace.current = working;
      if (!demo.current) window.workspace = working;
      const opened = await working.open();
      if (opened.type === 'opened')
        setHasWorkspaceItems(opened.summary.counts.items > 0);
      setReviewClient(working);
      const current = new ImportClient(
        () => {
          gate.assertReady();
          return new Worker(scriptURL(importWorkerURL), { type: 'module' });
        },
        (port) => {
          void working.connectImport(port);
        },
      );
      client.current = current;
      if (!demo.current)
        window.socialprune = { getImportSnapshot: () => current.snapshot };
      current.subscribe(setState);
    });
    return () => {
      unsubscribe();
      stopUpdates();
      updater.dispose();
      gate.dispose();
      navigator.serviceWorker?.removeEventListener(
        'message',
        updater.handleServiceWorkerMessages,
      );
      client.current?.dispose();
      workspace.current?.dispose();
    };
  }, [gate]);
  useEffect(() => {
    try {
      sessionStorage.setItem('sp-demo-active', String(demoActive));
    } catch {
      /* The current tab still keeps its in-memory demo mode. */
    }
    if (!demoActive || gateState === 'framed') return;
    // The gate terminated both pre-control instances before reporting ready.
    // Dispose their clients too, then resume using fresh, controlled entries.
    let active = true;
    const session = new DemoSession(gate);
    demo.current = session;
    window.workspace = session.workspace;
    window.socialprune = { getImportSnapshot: () => session.imports.snapshot };
    setDemoPhase('opening');
    setDemoResetDone(false);
    setDemoClient(null);
    const unsubscribe = session.imports.subscribe(setDemoSnapshot);
    void session
      .open()
      .then(() => {
        if (active) {
          setDemoClient(session.workspace);
          setDemoPhase('ready');
        }
      })
      .catch(() => {
        if (active) setDemoPhase('error');
      });
    return () => {
      active = false;
      unsubscribe();
      session.dispose();
      if (demo.current === session) demo.current = null;
      if (workspace.current) window.workspace = workspace.current;
      if (client.current) {
        const current = client.current;
        window.socialprune = { getImportSnapshot: () => current.snapshot };
      }
    };
  }, [demoActive, gateState, gate]);
  const activeClient = demoActive ? demoClient : reviewClient;
  const dataReady = demoActive ? demoPhase === 'ready' : gateState === 'ready';
  const hasItems = demoActive ? demoPhase === 'ready' : hasWorkspaceItems;
  useEffect(
    () =>
      reviewClient?.subscribeSummary((summary) => {
        setHasWorkspaceItems((summary?.counts.items ?? 0) > 0);
        setWorkspaceKind(summary?.kind ?? 'personal');
      }),
    [reviewClient],
  );
  useEffect(() => {
    if (activeClient) window.workspace = activeClient;
    const imports = demoActive ? demo.current?.imports : client.current;
    if (imports)
      window.socialprune = { getImportSnapshot: () => imports.snapshot };
  }, [activeClient, demoActive, gateState, state]);
  async function resetDemo() {
    const session = demo.current;
    if (!session) return;
    setDemoPhase('opening');
    setDemoResetDone(false);
    setDemoClient(null);
    location.hash = '#/demo';
    try {
      await session.reset();
      if (demo.current === session) {
        setDemoClient(session.workspace);
        setDemoPhase('ready');
        setDemoResetDone(true);
      }
    } catch {
      if (demo.current === session) setDemoPhase('error');
    }
  }
  useEffect(() => {
    heading.current?.focus();
    document.title = `${t('app.name')} · ${route}`;
  }, [route, locale]);
  const busy = state?.phase === 'importing' || state?.phase === 'aborting';
  const title =
    route === '/privacy'
      ? t('nav.privacy')
      : route === '/settings'
        ? t('nav.settings')
        : route.startsWith('/guide')
          ? t('nav.guide')
          : route === '/demo'
            ? t('nav.demo')
            : route === '/import'
              ? t('nav.import')
              : route === '/review'
                ? t('review.title')
                : route.startsWith('/clicklist/')
                  ? t('clicklist.title')
                  : route === '/backup'
                    ? t('backup.title')
                    : route === 'not-found'
                      ? t('page.notFound')
                      : t('app.name');
  if (gateState === 'framed')
    return (
      <main className={styles.main}>
        <h1>{t('gate.framed.title')}</h1>
        <p>{t('gate.framed.body')}</p>
      </main>
    );
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
          <a href="#/">{t('app.name')}</a>
          {route !== '/settings' && (
            <label>
              {t('settings.language')}{' '}
              <select
                value={locale}
                onChange={(event) => changeLocale(event.target.value as Locale)}
              >
                <option value="en" lang="en">
                  English
                </option>
                <option value="de" lang="de">
                  Deutsch
                </option>
              </select>
            </label>
          )}
        </header>
        {updateReady && !updateDismissed && (
          <section className={styles.update} aria-label={t('update.ready')}>
            <p>{t('update.ready')}</p>
            <div className={styles.actions}>
              <button
                onClick={() => {
                  void updates.current
                    ?.reloadNow()
                    .catch(() => setUpdateError(true));
                }}
              >
                {t('update.reload')}
              </button>
              <button onClick={() => setUpdateDismissed(true)}>
                {t('update.later')}
              </button>
            </div>
            {updateError && <p role="alert">{t('update.failed')}</p>}
          </section>
        )}
        <nav className={styles.navigation} aria-label={t('nav.start')}>
          <a href="#/">{t('nav.start')}</a>
          <a href="#/guide">{t('nav.guide')}</a>
          <a href="#/demo">{t('nav.demo')}</a>
          <a href="#/settings">{t('nav.settings')}</a>
          <a href="#/privacy">{t('nav.privacy')}</a>
          {hasItems && <a href="#/review">{t('review.title')}</a>}
          {hasItems && (
            <>
              <a href="#/clicklist/x">{t('clicklist.x')}</a>
              <a href="#/clicklist/instagram">{t('clicklist.instagram')}</a>
              <a href="#/backup">{t('backup.title')}</a>
            </>
          )}
        </nav>
        <main id="main" className={styles.main} data-gate={gateState}>
          <h1
            tabIndex={-1}
            ref={heading}
            className={route === '/' ? styles.heading : undefined}
          >
            {title}
          </h1>
          {(demoActive || workspaceKind === 'demo') && (
            <section
              className={styles.panel}
              data-testid="demo-banner"
              aria-label={t('nav.demo')}
            >
              <p>{t('demo.banner')}</p>
              {demoActive && (
                <button
                  disabled={demoPhase === 'opening'}
                  onClick={() => {
                    void resetDemo();
                  }}
                >
                  {t('demo.reset')}
                </button>
              )}
              {demoActive && demoPhase === 'opening' && (
                <p
                  role="status"
                  data-testid="demo-import-state"
                  data-phase={demoSnapshot?.phase ?? 'idle'}
                >
                  {t('demo.reading', {
                    count: demoSnapshot?.receivedItems ?? 0,
                  })}
                </p>
              )}
              {demoActive && demoPhase === 'error' && (
                <p role="alert">{t('demo.failed')}</p>
              )}
              {demoActive && demoResetDone && (
                <p role="status">{t('demo.resetDone')}</p>
              )}
            </section>
          )}
          {route === '/' && (
            <>
              <p>{t('start.description')}</p>
              <p className={styles.panel}>{t('start.privacy')}</p>
              <div className={styles.actions}>
                <a href="#/guide">{t('nav.guide')}</a>
                <button
                  className={styles.primary}
                  disabled={gateState !== 'ready'}
                  onClick={() => {
                    location.hash = '#/import';
                  }}
                >
                  {gateState === 'preparing'
                    ? t('gate.preparing')
                    : t('nav.import')}
                </button>
                <a href="#/demo">{t('nav.demo')}</a>
              </div>
            </>
          )}
          {gateState === 'unavailable' && (
            <section className={styles.panel} role="alert">
              <h2>{t('gate.unavailable.title')}</h2>
              <p>{t('gate.unavailable.body')}</p>
              <p>
                <code>npx socialprune import</code>
                <br />
                <code>npx socialprune review</code>
              </p>
            </section>
          )}
          {route.startsWith('/guide') && (
            <Guide route={route} locale={locale} />
          )}
          {route === '/privacy' && (
            <>
              {(
                [
                  'privacy.read',
                  'privacy.network',
                  'privacy.storage',
                  'privacy.agent',
                ] as const
              ).map((id) => (
                <p key={id}>{t(id)}</p>
              ))}
            </>
          )}
          {route === '/settings' && dataReady && activeClient && (
            <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
              <Settings
                client={activeClient}
                locale={locale}
                changeLocale={changeLocale}
                onDeleted={() => {
                  if (demoActive) setDemoActive(false);
                  else setHasWorkspaceItems(false);
                }}
                beforeDelete={async () => {
                  const current = client.current;
                  if (current?.snapshot.phase === 'importing') current.abort();
                  if (current?.snapshot.phase === 'aborting')
                    await new Promise<void>((resolve) => {
                      const unsubscribe = current.subscribe((snapshot) => {
                        if (
                          snapshot.phase !== 'aborting' &&
                          snapshot.phase !== 'importing'
                        ) {
                          unsubscribe();
                          resolve();
                        }
                      });
                    });
                }}
              />
            </Suspense>
          )}
          {route === '/import' && gateState === 'ready' && (
            <section>
              <p>{t('import.check')}</p>
              <p>{t('import.parts')}</p>
              <label className={styles.field}>
                {t('import.files')}
                <input
                  data-testid="archives"
                  type="file"
                  accept=".zip,application/zip"
                  multiple
                  disabled={busy}
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files ?? []))
                  }
                />
              </label>
              <div className={styles.actions}>
                <button
                  data-testid="import-button"
                  disabled={!state || busy || !files.length}
                  onClick={() => {
                    gate.assertReady();
                    void (async () => {
                      if (!workspace.current?.summary)
                        await workspace.current?.open();
                      client.current?.start(files);
                    })();
                  }}
                >
                  {t('import.start')}
                </button>
                <button
                  data-testid="abort-button"
                  disabled={state?.phase !== 'importing'}
                  onClick={() => client.current?.abort()}
                >
                  {t('import.cancel')}
                </button>
                <button
                  onClick={() => {
                    void workspace.current?.downloadBackup();
                  }}
                >
                  {t('workspace.backup')}
                </button>
              </div>
              <p
                role="status"
                data-testid="import-state"
                data-phase={state?.phase ?? 'idle'}
                className={styles.count}
              >
                {state?.phase === 'importing' || state?.phase === 'aborting'
                  ? t('import.reading', { count: state.receivedItems })
                  : state?.phase === 'complete'
                    ? t('import.complete', { count: state.receivedItems })
                    : state?.phase === 'aborted'
                      ? t('import.cancelled')
                      : t('import.idle')}
              </p>
              {state?.phase === 'error' && (
                <p role="alert">{t('import.error')}</p>
              )}
              {state?.summary && (
                <section aria-label={t('import.result')}>
                  <h2>
                    {t('import.result')}: {state.summary.status}
                  </h2>
                  {state.summary.status === 'unknown-format' && (
                    <p>{t('import.unknown')}</p>
                  )}
                  {state.summary.status === 'html-export' && (
                    <p>{t('import.html')}</p>
                  )}
                  <a href="#/review">{t('review.title')}</a>
                  {state.summary.records.map((record) => (
                    <section key={record.id}>
                      <h3>
                        {t('import.account', {
                          platform: record.platform,
                          count: record.itemCount,
                        })}
                      </h3>
                      <ul>
                        {record.accounts.map((account) => (
                          <li key={account.key}>
                            {account.handle ?? account.key}
                          </li>
                        ))}
                      </ul>
                      <ul>
                        {record.diagnostics.map((diagnostic, index) => (
                          <li key={index}>
                            {diagnostic.category === 'unsupported-compression'
                              ? t('import.deflate64', {
                                  file: diagnostic.files.join(', '),
                                })
                              : diagnostic.category === 'encrypted-entry'
                                ? t('import.encrypted', {
                                    file: diagnostic.files.join(', '),
                                  })
                                : `${diagnostic.category}: ${diagnostic.status}`}{' '}
                            ({diagnostic.count})
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </section>
              )}
            </section>
          )}
          {route === '/import' && gateState === 'preparing' && (
            <p role="status">{t('gate.preparing')}</p>
          )}
          {(route === '/review' || route === '/demo') &&
            dataReady &&
            activeClient && (
              <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
                <Review
                  key={demoActive ? 'demo' : 'personal'}
                  client={activeClient}
                />
              </Suspense>
            )}
          {route.startsWith('/clicklist/') && dataReady && activeClient && (
            <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
              <ClickList
                key={route}
                client={activeClient}
                platform={route === '/clicklist/x' ? 'x' : 'instagram'}
              />
            </Suspense>
          )}
          {route === '/backup' && dataReady && activeClient && (
            <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
              <Backup
                client={activeClient}
                allowRestore={!demoActive}
                onRestored={() => setHasWorkspaceItems(true)}
              />
            </Suspense>
          )}
          {state?.phase === 'error' && (
            <section role="alert">
              <p>{t('workspace.storageError')}</p>
              <button
                onClick={() => {
                  void workspace.current?.downloadBackup();
                }}
              >
                {t('workspace.backup')}
              </button>
            </section>
          )}
          {route === 'not-found' && <a href="#/">{t('page.return')}</a>}
        </main>
        {import.meta.env.DEV && (
          <footer className={styles.footer}>{t('development.policy')}</footer>
        )}
      </div>
    </CSPProvider>
  );
}

export function Shell() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  return (
    <IntlProvider locale={locale} messages={catalogs[locale]}>
      <Content
        locale={locale}
        changeLocale={(value) => {
          setLocale(value);
          document.documentElement.lang = value;
          try {
            localStorage.setItem('sp-locale', value);
          } catch {
            /* In-memory language switching still works. */
          }
        }}
      />
    </IntlProvider>
  );
}
