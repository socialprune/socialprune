import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { afterEach, expect, test, vi } from 'vitest';
import { Settings } from '../settings/Settings.tsx';
import en from '../i18n/en.json';
import de from '../i18n/de.json';
import { WorkspaceClient } from '../workspace/client.ts';

vi.mock('virtual:sp-build-info', () => ({ buildId: 'test-build' }));
afterEach(() => vi.unstubAllGlobals());
test.each(['en', 'de'] as const)(
  'settings reuse hides browser storage and delete in %s only in local-review mode',
  (locale) => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('localStorage', { getItem: () => null });
    const client = new WorkspaceClient(
      Object.assign(new EventTarget(), { postMessage() {}, terminate() {} }),
    );
    const messages = locale === 'en' ? en : de;
    const render = (storageMode: 'browser' | 'local-review') =>
      renderToStaticMarkup(
        createElement(
          IntlProvider,
          { locale, messages },
          createElement(Settings, {
            client,
            locale,
            changeLocale() {},
            storageMode,
          }),
        ),
      );
    const local = render('local-review'),
      pages = render('browser');
    for (const id of [
      'settings.storage',
      'settings.deleteTitle',
      'settings.persistAction',
    ] as const) {
      expect(pages).toContain(messages[id]);
      expect(local).not.toContain(messages[id]);
    }
    expect(local).toContain(messages['settings.timeZone']);
    expect(local).toContain(messages['settings.language']);
  },
);
