import { useEffect, useRef, useState } from 'react';
import { Archive, Ellipsis, Layers3, Sprout, Trash2 } from 'lucide-react';
import { useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import styles from './Shell.module.css';

/** A disclosure of ordinary links, not an application menu with arrow-key roles. */
export function Navigation({
  route,
  locale,
  changeLocale,
}: {
  route: string;
  locale: Locale;
  changeLocale: (value: Locale) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [route]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!area.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <header className={styles.header}>
      <a href="#/" className={styles.brand} aria-label={t('app.name')}>
        <Sprout size={24} aria-hidden="true" />
        <span>{t('app.name')}</span>
      </a>
      <nav className={styles.navigation} aria-label={t('nav.primary')}>
        <a
          href="#/review"
          aria-current={
            route.startsWith('/review') || route === '/demo'
              ? 'page'
              : undefined
          }
        >
          <Layers3 size={18} aria-hidden="true" />
          {t('review.title')}
        </a>
        <a
          href="#/clicklist/x/go"
          aria-current={route.startsWith('/clicklist') ? 'page' : undefined}
        >
          <Trash2 size={18} aria-hidden="true" />
          {t('nav.delete')}
        </a>
        <a
          href="#/archive"
          aria-current={route === '/archive' ? 'page' : undefined}
        >
          <Archive size={18} aria-hidden="true" />
          {t('nav.archive')}
        </a>
      </nav>
      <div className={styles.menuArea} ref={area}>
        <button
          className={styles.menuTrigger}
          ref={trigger}
          aria-expanded={open}
          aria-controls="app-menu"
          aria-label={t('nav.more')}
          onClick={() => setOpen((value) => !value)}
        >
          <Ellipsis size={22} aria-hidden="true" />
        </button>
        <div
          id="app-menu"
          className={styles.menuPanel}
          hidden={!open}
          data-testid="app-menu"
        >
          <nav aria-label={t('nav.more')}>
            <a href="#/">{t('nav.start')}</a>
            <a href="#/import">{t('nav.import')}</a>
            <a href="#/demo">{t('nav.demo')}</a>
            <a href="#/guide">{t('nav.guide')}</a>
            <a href="#/backup">{t('backup.title')}</a>
            <a href="#/settings">{t('nav.settings')}</a>
            <a href="#/privacy">{t('nav.privacy')}</a>
            <a href="#/review/list">{t('proto.listView')}</a>
          </nav>
          {route !== '/settings' && (
            <label>
              {t('settings.language')}
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
        </div>
      </div>
    </header>
  );
}
