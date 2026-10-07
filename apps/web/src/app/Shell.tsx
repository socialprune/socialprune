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
import { buildId } from 'virtual:sp-build-info';
import { WorkerGate } from './gate.ts';
import type { GateState } from './gate.ts';
import { scriptURL } from './trusted-urls.ts';
import { parseRoute } from './router.ts';
import { AppUpdates } from './updates.ts';
import { guides } from './guide.ts';
import styles from './Shell.module.css';
const Review = lazy(() =>
  import('../review/Review.tsx').then((module) => ({ default: module.Review })),
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
  const [appearance, setAppearance] = useState(
    () => document.documentElement.dataset.theme ?? 'system',
  );
  const [reviewClient, setReviewClient] = useState<WorkspaceClient | null>(
    null,
  );
  const [hasWorkspaceItems, setHasWorkspaceItems] = useState(false);
  const [singleKeys, setSingleKeys] = useState(
    () => localStorage.getItem('sp-single-keys') !== 'off',
  );
  const client = useRef<ImportClient | null>(null);
  const workspace = useRef<WorkspaceClient | null>(null);
  const updates = useRef<AppUpdates | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    const changed = () => setRoute(parseRoute(location.hash));
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
    // Start demo-only work immediately on a first-visit demo route. The gate
    // owns its termination; no selected file is passed to this instance.
    if (route === '/demo') gate.startDemo();
    void gate.ensure().then(async () => {
      if (gate.serviceWorkerRegistration)
        updater.watch(gate.serviceWorkerRegistration);
      if (gate.state !== 'ready') return;
      const working = new WorkspaceClient(
        new Worker(scriptURL(workspaceWorkerURL), { type: 'module' }),
      );
      workspace.current = working;
      window.workspace = working;
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
    heading.current?.focus();
    document.title = `${t('app.name')} · ${route}`;
    if (['/clicklist/x', '/clicklist/instagram', '/backup'].includes(route))
      location.hash = '#/import';
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
          {hasWorkspaceItems && <a href="#/review">{t('review.title')}</a>}
        </nav>
        <main id="main" className={styles.main} data-gate={gateState}>
          <h1
            tabIndex={-1}
            ref={heading}
            className={route === '/' ? styles.heading : undefined}
          >
            {title}
          </h1>
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
            <section data-guide-count={guides.length}>
              <h2>{t('guide.pending')}</h2>
              <p>{t('guide.pending.body')}</p>
              <a href="#/guide/x">{t('guide.x')}</a>{' '}
              <a href="#/guide/instagram">{t('guide.instagram')}</a>
            </section>
          )}
          {route === '/demo' && (
            <>
              <p className={styles.panel}>{t('demo.banner')}</p>
              <p>{t('demo.pending')}</p>
            </>
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
          {route === '/settings' && (
            <>
              <p>{t('settings.foundation')}</p>
              <label className={styles.field}>
                {t('settings.appearance')}
                <select
                  value={appearance}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAppearance(value);
                    if (value === 'system')
                      delete document.documentElement.dataset.theme;
                    else document.documentElement.dataset.theme = value;
                    try {
                      localStorage.setItem('sp-theme', value);
                    } catch {
                      /* The preference can remain in memory. */
                    }
                  }}
                >
                  <option value="system">{t('settings.system')}</option>
                  <option value="light">{t('settings.light')}</option>
                  <option value="dark">{t('settings.dark')}</option>
                </select>
              </label>
              <p>{t('settings.build', { id: buildId })}</p>
              <label className={styles.field}>
                {t('review.singleKeys')}
                <select
                  value={singleKeys ? 'on' : 'off'}
                  onChange={(event) => {
                    const enabled = event.target.value === 'on';
                    setSingleKeys(enabled);
                    localStorage.setItem(
                      'sp-single-keys',
                      enabled ? 'on' : 'off',
                    );
                  }}
                >
                  <option value="on">{t('review.on')}</option>
                  <option value="off">{t('review.off')}</option>
                </select>
              </label>
            </>
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
                    client.current?.start(files);
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
          {route === '/review' && gateState === 'ready' && reviewClient && (
            <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
              <Review client={reviewClient} />
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
