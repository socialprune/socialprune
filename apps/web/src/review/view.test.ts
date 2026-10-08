import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReviewView } from '@socialprune/core';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import { WorkspaceClient } from '../workspace/client.ts';
import { Review } from './Review.tsx';
import { initialReviewView, ReviewViewWriter } from './view.ts';
import en from '../i18n/en.json';
import { ReviewViewSchema } from '@socialprune/core/workspace/protocol';
const parse = (value: unknown) => {
  const result = ReviewViewSchema.safeParse(value);
  return result.success ? result.data : undefined;
};

const view: ReviewView = {
  accountKey: 'x:second',
  filter: { decisions: ['later'] },
  sort: [{ by: 'createdAt', direction: 'desc' }],
  search: 'Generated café',
};
const summary: WorkspaceSummary = {
  workspaceId: 'generated',
  schemaVersion: 2,
  kind: 'personal',
  accounts: [
    { key: 'x:first', handle: null },
    { key: 'x:second', handle: null },
  ],
  counts: {
    imports: 0,
    items: 0,
    assessments: 0,
    submissions: 0,
    decisionEvents: 0,
    outcomeEvents: 0,
  },
  decisions: { keep: 0, delete: 0, later: 0, undecided: 0 },
  outcomes: { unknown: 0, skipped: 0, 'deleted-by-user': 0 },
  revision: 0,
  timeZone: null,
  lastBackupAt: null,
  review: view,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('D58 initial view accepts stored fields but rejects unknown accounts and invalid values as a whole', () => {
  expect(initialReviewView(summary, parse)).toEqual(view);
  const fallback = {
    accountKey: 'x:first',
    filter: {},
    sort: [
      { by: 'risk', direction: 'desc' },
      { by: 'createdAt', direction: 'desc' },
      { by: 'id', direction: 'asc' },
    ],
    search: '',
  };
  expect(initialReviewView({ ...summary, review: undefined }, parse)).toEqual(
    fallback,
  );
  expect(
    initialReviewView(
      {
        ...summary,
        review: { ...view, accountKey: 'x:missing' },
      },
      parse,
    ),
  ).toEqual(fallback);
  const invalid: unknown = {
    ...summary,
    review: { ...view, filter: { decisions: ['invalid'] } },
  };
  expect(initialReviewView(invalid as WorkspaceSummary, parse)).toEqual(
    fallback,
  );
  expect(initialReviewView(null, parse).accountKey).toBeNull();
});

test('D58 real review initial render uses stored controls and never writes during mount', () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const postMessage = vi.fn();
  const client = new WorkspaceClient(
    Object.assign(new EventTarget(), { postMessage, terminate() {} }),
  );
  client.summary = summary;
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: en },
      createElement(Review, { client }),
    ),
  );
  expect(html).toContain('<option value="x:second" selected="">');
  expect(html).toContain('<option value="later" selected="">');
  expect(html).toContain('<option value="createdAt" selected="">');
  expect(html).toContain('value="Generated café"');
  expect(postMessage).not.toHaveBeenCalled();
});

test('D58 writer is inert at construction and flush, debounces person search changes and isolates workspaces', () => {
  vi.useFakeTimers();
  const personal = vi.fn(),
    demo = vi.fn();
  const writer = new ReviewViewWriter(personal),
    other = new ReviewViewWriter(demo);
  writer.flush();
  other.flush();
  vi.advanceTimersByTime(1000);
  expect(personal).not.toHaveBeenCalled();
  expect(demo).not.toHaveBeenCalled();
  writer.change({ ...view, search: 'G' }, true);
  vi.advanceTimersByTime(100);
  writer.change(view, true);
  vi.advanceTimersByTime(149);
  expect(personal).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(personal.mock.calls).toEqual([[view]]);
  other.change({ ...view, accountKey: 'x:demo' });
  expect(demo.mock.calls).toEqual([[{ ...view, accountKey: 'x:demo' }]]);
  writer.change({ ...view, search: 'pending' }, true);
  writer.flush();
  vi.advanceTimersByTime(150);
  expect(personal.mock.calls).toEqual([
    [view],
    [{ ...view, search: 'pending' }],
  ]);
});
