import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { ReviewApp } from './ReviewShell.tsx';
import { ReviewSession } from './session.ts';
import { LocalReviewClient } from './client.ts';
import en from '../i18n/en.json';
import de from '../i18n/de.json';

afterEach(() => vi.unstubAllGlobals());
test('shared review backup action in local mode points at CLI instructions without a workspace request', async () => {
  const location = { hash: '#/review' };
  vi.stubGlobal('location', location);
  const postMessage = vi.fn();
  const client = new LocalReviewClient(
    Object.assign(new EventTarget(), { postMessage, terminate() {} }),
  );
  await client.downloadBackup();
  expect(location.hash).toBe('#/backup');
  expect(postMessage).not.toHaveBeenCalled();
});
function environment(locale: 'en' | 'de', hash: string) {
  vi.stubGlobal('location', { hash });
  vi.stubGlobal('localStorage', { getItem: () => locale });
  vi.stubGlobal('navigator', { language: locale });
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as const,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ csrf: 'C'.repeat(43) }));
  const session = new ReviewSession({
    isTopLevel: true,
    location: {
      hash: `#bootstrap=${'B'.repeat(43)}`,
      pathname: '/',
      search: '',
      origin: 'http://127.0.0.1:45678',
    },
    history: { replaceState() {} },
    document: doc,
    fetch: fetcher,
  });
  return { session, fetcher, text: locale === 'en' ? en : de };
}

test.each(['en', 'de'] as const)(
  'preparing, framed and ended states in %s mount no router/workspace subtree',
  (locale) => {
    const { session, fetcher, text } = environment(locale, '#/review');
    for (const state of ['preparing', 'framed', 'ended'] as const) {
      session.state = state;
      const html = renderToStaticMarkup(createElement(ReviewApp, { session }));
      expect(html).toContain(`data-session="${state}"`);
      expect(html).not.toContain('data-router-started');
      expect(html).not.toContain('<nav');
      expect(html).not.toContain('role="grid"');
      expect(fetcher).not.toHaveBeenCalled();
      if (state === 'ended')
        expect(html).toContain(text['localReview.endedTitle']);
    }
  },
);

test.each(['en', 'de'] as const)(
  'ready-only CLI pointer pages in %s name their command with catalog copy',
  async (locale) => {
    for (const [route, id, command] of [
      ['/guide', 'localReview.guide', 'socialprune guide'],
      ['/demo', 'localReview.demo', 'socialprune import'],
      ['/import', 'localReview.import', 'socialprune import'],
      ['/backup', 'localReview.backup', 'socialprune backup export'],
    ] as const) {
      const { session, fetcher, text } = environment(locale, `#${route}`);
      await session.start();
      const html = renderToStaticMarkup(createElement(ReviewApp, { session }));
      expect(html).toContain('data-router-started="true"');
      expect(html).toContain(text[id]);
      expect(html).toContain(`<code>${command}</code>`);
      expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/session']);
      session.end();
    }
  },
);
