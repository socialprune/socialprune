import '../styles/tokens.css';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { IntlProvider } from 'react-intl';
import { catalogs, initialLocale, useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { LocalReviewClient } from './client.ts';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import { parseReviewRoute } from '../app/router.ts';
import type { ReviewSession } from './session.ts';
import { Navigation } from '../app/Navigation.tsx';
import styles from '../app/Shell.module.css';

const Review = lazy(() =>
  import('../review/Review.tsx').then((module) => ({ default: module.Review })),
);
const CardReview = lazy(() =>
  import('../review/CardReview.tsx').then((module) => ({
    default: module.CardReview,
  })),
);
const ArchiveView = lazy(() =>
  import('../archive/Archive.tsx').then((module) => ({
    default: module.Archive,
  })),
);
const DeleteMode = lazy(() =>
  import('../clicklist/DeleteMode.tsx').then((module) => ({
    default: module.DeleteMode,
  })),
);
const ClickList = lazy(() =>
  import('../clicklist/ClickList.tsx').then((module) => ({
    default: module.ClickList,
  })),
);
const Settings = lazy(() =>
  import('../settings/Settings.tsx').then((module) => ({
    default: module.Settings,
  })),
);

const pointers = {
  '/guide': {
    title: 'nav.guide',
    text: 'localReview.guide',
    command: 'socialprune guide',
  },
  '/demo': {
    title: 'nav.demo',
    text: 'localReview.demo',
    command: 'socialprune import',
  },
  '/import': {
    title: 'nav.import',
    text: 'localReview.import',
    command: 'socialprune import',
  },
  '/backup': {
    title: 'backup.title',
    text: 'localReview.backup',
    command: 'socialprune backup export',
  },
} as const;

function ReadyReview({
  session,
  locale,
  changeLocale,
}: {
  session: ReviewSession;
  locale: Locale;
  changeLocale: (value: Locale) => void;
}) {
  const t = useT();
  const [client] = useState(() => {
    if (!session.port) throw new Error('Review session has no transport.');
    return new LocalReviewClient(session.port, 'active');
  });
  const [route, setRoute] = useState(() => parseReviewRoute(location.hash));
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const changed = () => setRoute(parseReviewRoute(location.hash));
    window.addEventListener('hashchange', changed);
    window.workspace = client;
    const stopSummary = client.subscribeSummary(setSummary);
    const stopChanges = client.subscribe((notice) => {
      if (notice.type === 'changed') void client.open().catch(() => undefined);
    });
    void client.open().catch(() => undefined);
    return () => {
      window.removeEventListener('hashchange', changed);
      stopSummary();
      stopChanges();
      client.dispose();
      if (window.workspace === client)
        Reflect.deleteProperty(window, 'workspace');
    };
  }, [client]);
  useEffect(() => {
    heading.current?.focus();
    document.title = `${t('app.name')} · ${route}`;
  }, [route, locale]);
  useEffect(() => {
    const flush = () => {
      void client.flushCommands().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
    };
  }, [client]);
  const pointer = Object.hasOwn(pointers, route)
    ? pointers[route as keyof typeof pointers]
    : null;
  const title = pointer
    ? t(pointer.title)
    : route.startsWith('/review')
      ? t('review.title')
      : route === '/archive'
        ? t('proto.archiveTitle')
        : route.endsWith('/go')
          ? t('proto.goTitle')
          : route.startsWith('/clicklist/')
            ? t('clicklist.title')
            : route === '/settings'
              ? t('nav.settings')
              : route === '/privacy'
                ? t('nav.privacy')
                : route === 'not-found'
                  ? t('page.notFound')
                  : t('app.name');
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
        <Navigation route={route} locale={locale} changeLocale={changeLocale} />
        <main
          id="main"
          className={styles.main}
          data-gate="ready"
          data-router-started="true"
        >
          <h1 tabIndex={-1} ref={heading}>
            {title}
          </h1>
          {route === '/' && (
            <>
              <p className={styles.panel}>{t('localReview.privacy')}</p>
              {summary ? (
                <>
                  <p>
                    {t('localReview.summary', {
                      items: summary.counts.items,
                      keep: summary.decisions.keep,
                      marked: summary.decisions.delete,
                      later: summary.decisions.later,
                      undecided: summary.decisions.undecided,
                    })}
                  </p>
                  <a href="#/review">{t('review.title')}</a>
                </>
              ) : (
                <p role="status">{t('gate.preparing')}</p>
              )}
            </>
          )}
          {pointer && (
            <section>
              <p>{t(pointer.text)}</p>
              <code>{pointer.command}</code>
            </section>
          )}
          {route === '/privacy' && (
            <>
              <p>{t('localReview.privacy')}</p>
              <p>{t('localReview.decisions')}</p>
              <p>{t('privacy.agent')}</p>
            </>
          )}
          <Suspense fallback={<p role="status">{t('gate.preparing')}</p>}>
            {route === '/review' && <CardReview client={client} />}
            {route === '/review/list' && (
              <>
                <a href="#/review">{t('proto.cardView')}</a>
                <Review client={client} />
              </>
            )}
            {route === '/archive' && <ArchiveView client={client} />}
            {route.endsWith('/go') && (
              <DeleteMode
                key={route}
                client={client}
                platform={route.includes('/x/') ? 'x' : 'instagram'}
              />
            )}
            {route.startsWith('/clicklist/') && !route.endsWith('/go') && (
              <ClickList
                key={route}
                client={client}
                platform={route === '/clicklist/x' ? 'x' : 'instagram'}
              />
            )}
            {route === '/settings' && (
              <Settings
                client={client}
                locale={locale}
                changeLocale={changeLocale}
                storageMode="local-review"
              />
            )}
          </Suspense>
          {route === 'not-found' && <a href="#/">{t('page.return')}</a>}
        </main>
      </div>
    </CSPProvider>
  );
}

export function ReviewApp({ session }: { session: ReviewSession }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [state, setState] = useState(session.state);
  useEffect(() => session.subscribe(setState), [session]);
  return (
    <IntlProvider locale={locale} messages={catalogs[locale]}>
      <SessionContent
        session={session}
        state={state}
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

function SessionContent({
  session,
  state,
  locale,
  changeLocale,
}: {
  session: ReviewSession;
  state: ReviewSession['state'];
  locale: Locale;
  changeLocale: (value: Locale) => void;
}) {
  const t = useT();
  if (state === 'ready')
    return (
      <ReadyReview
        session={session}
        locale={locale}
        changeLocale={changeLocale}
      />
    );
  return (
    <main className={styles.main} data-session={state}>
      <h1>
        {t(
          state === 'framed'
            ? 'gate.framed.title'
            : state === 'ended'
              ? 'localReview.endedTitle'
              : 'app.name',
        )}
      </h1>
      <p>
        {t(
          state === 'framed'
            ? 'localReview.framed'
            : state === 'ended'
              ? 'localReview.endedBody'
              : 'gate.preparing',
        )}
      </p>
      {state === 'ended' && <code>socialprune review</code>}
    </main>
  );
}

export function mountReview(session: ReviewSession) {
  document.documentElement.lang = initialLocale();
  try {
    const theme = localStorage.getItem('sp-theme');
    if (theme === 'light' || theme === 'dark')
      document.documentElement.dataset.theme = theme;
    if (localStorage.getItem('sp-density') === 'compact')
      document.documentElement.dataset.density = 'compact';
  } catch {
    /* The review can start without persistent preferences. */
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing application root.');
  createRoot(root).render(<ReviewApp session={session} />);
}
