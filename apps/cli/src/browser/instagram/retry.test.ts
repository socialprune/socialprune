import { expect, test, vi } from 'vitest';
import {
  PostOpenRetries,
  POST_REOPEN_WAIT_MS,
  FilteredListTimeout,
} from './retry.ts';
import {
  ContextStop,
  errorClass,
  PostRetriesSchema,
  stopDetails,
  stopDetailText,
} from './report.ts';
import {
  IG_FIXTURE,
  instagramFixture,
} from '../../../e2e/fake-instagram/fixture.ts';
import { loadList, productionContext } from './driver.ts';
import * as selectors from './selectors.ts';
import * as filter from './filter.ts';
import type { Page } from 'playwright-core';
import { errors } from 'playwright-core';

test('C26 real Playwright click TimeoutError is classified as timeout and is eligible for the unchanged post retry policy', () => {
  const failure = new errors.TimeoutError(
    'locator.click: Timeout 5000ms exceeded.',
  );
  expect(failure.name).toBe('TimeoutError');
  expect(errorClass(failure)).toBe('timeout');
  expect(stopDetails(failure)).toMatchObject({ token: 'browser-timeout' });
  expect(
    new PostOpenRetries().begin(failure, ['generated-comment'], 5, false, true),
  ).toMatchObject({ step: 5, stage: 'post-open' });
});

test('C25 filtered-list reopen shares IG-16s three-reopen budget and the once-per-target set with posts', () => {
  const retries = new PostOpenRetries();
  const empty = new FilteredListTimeout();
  const timeout = new Error();
  timeout.name = 'TimeoutError';
  const list = retries.beginList(
    empty,
    ['generated-comment-1'],
    1,
    false,
    true,
  );
  expect(list).toEqual({
    step: 1,
    retryStep: null,
    stage: 'list',
    waitedMs: 0,
    outcome: null,
  });
  expect(
    retries.beginList(empty, ['generated-comment-1'], 2, false, true),
  ).toBeNull();
  expect(
    retries.begin(
      timeout,
      ['generated-comment-1', 'generated-post-1'],
      2,
      false,
      true,
    ),
  ).toBeNull();
  expect(
    retries.begin(
      timeout,
      ['generated-comment-2', 'generated-post-2'],
      3,
      false,
      true,
    ),
  ).not.toBeNull();
  expect(
    retries.beginList(empty, ['generated-comment-2'], 4, false, true),
  ).toBeNull();
  expect(
    retries.beginList(empty, ['generated-comment-3'], 5, false, true),
  ).not.toBeNull();
  expect(
    retries.beginList(empty, ['generated-comment-4'], 7, false, true),
  ).toBeNull();
  expect(
    retries.begin(timeout, ['generated-comment-5'], 7, false, true),
  ).toBeNull();
  expect(retries.summary().used).toBe(3);
  expect(PostRetriesSchema.parse(retries.summary())).toEqual(retries.summary());
  for (const value of [
    'generated-comment',
    'generated-post',
    ...Object.values(IG_FIXTURE.other),
  ])
    expect(JSON.stringify(retries.summary())).not.toContain(value);
});
test('C25 only a filtered empty-list timeout may retry, never an initial timeout, other guard, canary or capped step', () => {
  const retries = new PostOpenRetries();
  for (const error of [
    new ContextStop('PLATFORM_CHECK', 'list-timeout'),
    new ContextStop('PLATFORM_CHECK', 'notice-error'),
    new ContextStop('PLATFORM_CHECK', 'http-429'),
    new ContextStop('ACCOUNT_MISMATCH', 'account-changed'),
    new Error(),
  ])
    expect(retries.beginList(error, ['generated'], 1, false, true)).toBeNull();
  expect(
    retries.beginList(new FilteredListTimeout(), ['generated'], 1, true, true),
  ).toBeNull();
  expect(
    retries.beginList(
      new FilteredListTimeout(),
      ['generated'],
      1,
      false,
      false,
    ),
  ).toBeNull();
  expect(retries.summary()).toEqual({ used: 0, entries: [] });
});
test('C25 list retry records remain strict closed data and preserve the existing list-timeout stop', () => {
  const failure = new FilteredListTimeout();
  expect(failure).toMatchObject({
    code: 'PLATFORM_CHECK',
    token: 'list-timeout',
  });
  expect(stopDetails(failure)).toEqual({
    code: 'PLATFORM_CHECK',
    token: 'list-timeout',
  });
  expect(stopDetailText(failure)).toBe('list-timeout');
  const entry = {
    step: 1,
    retryStep: 2,
    stage: 'list',
    waitedMs: 60000,
    outcome: 'ready',
  };
  expect(PostRetriesSchema.parse({ used: 1, entries: [entry] })).toEqual({
    used: 1,
    entries: [entry],
  });
  for (const invalid of [
    { ...entry, stage: 'navigation' },
    { ...entry, outcome: IG_FIXTURE.other.text },
    { ...entry, path: `/${IG_FIXTURE.other.username}/` },
  ])
    expect(() =>
      PostRetriesSchema.parse({ used: 1, entries: [invalid] }),
    ).toThrow();
});
test.each(['initial-empty', 'filtered-empty', 'filtered-other'] as const)(
  'C25 driver %s marks only the empty filtered result and uses no new action kind',
  async (mode) => {
    const fixture = await instagramFixture();
    const item = fixture.items[0]!,
      expected = item.account.handle!;
    let clock = 0,
      filtered = false;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const pageCheck = vi.spyOn(selectors, 'checkPage').mockResolvedValue();
    const outside = vi
      .spyOn(selectors, 'outsideProfilePaths')
      .mockResolvedValue([`/${expected}/`]);
    const choices = vi.spyOn(filter, 'chooseFilterDate').mockResolvedValue();
    const click = vi
      .spyOn(selectors, 'clickAllowed')
      .mockImplementation((_page, action) => {
        if (action.kind === 'named' && action.name === 'Apply') filtered = true;
        return Promise.resolve();
      });
    const rows = vi.spyOn(selectors, 'readRows').mockImplementation(() => {
      if (mode === 'initial-empty' || filtered) {
        clock = 200;
        return Promise.resolve(
          mode === 'filtered-other'
            ? [
                {
                  index: 0,
                  username: IG_FIXTURE.other.username,
                  text: item.text,
                  age: '1w',
                },
              ]
            : [],
        );
      }
      return Promise.resolve([
        { index: 0, username: expected, text: item.text, age: '1w' },
      ]);
    });
    const page = { goto: () => Promise.resolve() } as unknown as Page;
    try {
      const error = await loadList(
        page,
        item,
        expected,
        { ...productionContext, responseMs: 100 },
        () => {},
      ).catch((failure: unknown) => failure);
      const retries = new PostOpenRetries();
      if (mode === 'filtered-empty') {
        expect(error).toBeInstanceOf(FilteredListTimeout);
        expect(
          retries.beginList(error, [item.id], 1, false, true),
        ).toMatchObject({ stage: 'list' });
      } else {
        expect(error).not.toBeInstanceOf(FilteredListTimeout);
        expect(retries.beginList(error, [item.id], 1, false, true)).toBeNull();
        expect(error).toMatchObject({
          code:
            mode === 'initial-empty' ? 'PLATFORM_CHECK' : 'ACCOUNT_MISMATCH',
        });
      }
      expect(click.mock.calls.map((call) => call[1])).toEqual(
        mode === 'initial-empty'
          ? []
          : [
              { kind: 'named', name: 'Sort & filter' },
              { kind: 'named', name: 'Oldest to newest' },
              { kind: 'named', name: 'Apply' },
            ],
      );
      expect(choices).toHaveBeenCalledTimes(mode === 'initial-empty' ? 0 : 2);
    } finally {
      rows.mockRestore();
      click.mockRestore();
      choices.mockRestore();
      outside.mockRestore();
      pageCheck.mockRestore();
      now.mockRestore();
    }
  },
);

test('C23 post-open retry policy permits one reopen per target and three per run without an environment shortcut', () => {
  const retries = new PostOpenRetries();
  const timeout = new Error(IG_FIXTURE.other.text);
  timeout.name = 'TimeoutError';
  expect(POST_REOPEN_WAIT_MS).toBe(60000);
  const first = retries.begin(
    timeout,
    ['generated-item-1', 'generated-post-1'],
    1,
    false,
    true,
  );
  expect(first).toMatchObject({
    step: 1,
    retryStep: null,
    stage: 'post-open',
    waitedMs: 0,
    outcome: null,
  });
  expect(
    retries.begin(timeout, ['generated-item-1'], 2, false, true),
  ).toBeNull();
  expect(
    retries.begin(
      timeout,
      ['generated-other-item', 'generated-post-1'],
      3,
      false,
      true,
    ),
  ).toBeNull();
  expect(
    retries.begin(timeout, ['generated-item-2'], 3, false, true),
  ).not.toBeNull();
  expect(
    retries.begin(timeout, ['generated-item-3'], 5, false, true),
  ).not.toBeNull();
  expect(
    retries.begin(timeout, ['generated-item-4'], 7, false, true),
  ).toBeNull();
  expect(retries.summary().used).toBe(3);
  expect(() =>
    PostRetriesSchema.parse({
      used: 1,
      entries: [
        {
          step: 1,
          retryStep: 2,
          stage: 'post-open',
          waitedMs: 60000,
          outcome: IG_FIXTURE.other.text,
        },
      ],
    }),
  ).toThrow();
  expect(JSON.stringify(retries.summary())).not.toContain('generated-item');
});
test('C23 notices generic failures canaries and exhausted capacity never authorize a post reopen', () => {
  const retry = new PostOpenRetries();
  const timeout = new Error();
  timeout.name = 'TimeoutError';
  for (const failure of [
    new ContextStop('PLATFORM_CHECK', 'notice-error'),
    new ContextStop('PLATFORM_CHECK', 'http-429'),
    new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure'),
    new Error(),
  ])
    expect(retry.begin(failure, ['generated'], 1, false, true)).toBeNull();
  expect(retry.begin(timeout, ['generated'], 1, true, true)).toBeNull();
  expect(retry.begin(timeout, ['generated'], 1, false, false)).toBeNull();
  expect(retry.summary()).toEqual({ used: 0, entries: [] });
});
