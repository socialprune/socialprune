import { expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import {
  loadList,
  productionContext,
  postReopenTarget,
  reopenCandidate,
} from './driver.ts';
import * as selectors from './selectors.ts';
import { stopDetails } from './report.ts';
import type { RowReadCounts } from './selectors.ts';
import * as filterHelpers from './filter.ts';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';

test('C27 diagnostic attach and DOM read failures retain the original filtered timeout with explicit observation failure', async () => {
  const fixture = await instagramFixture();
  let clock = 0,
    filtered = false;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const check = vi.spyOn(selectors, 'checkPage').mockResolvedValue();
  const outside = vi
    .spyOn(selectors, 'outsideProfilePaths')
    .mockResolvedValue([`/${fixture.items[0]!.account.handle}/`]);
  const choices = vi
    .spyOn(filterHelpers, 'chooseFilterDate')
    .mockResolvedValue();
  const click = vi
    .spyOn(selectors, 'clickAllowed')
    .mockImplementation((_page, action, _guard, dispatched) => {
      if (action.kind === 'named' && action.name === 'Apply') {
        dispatched?.();
        filtered = true;
      }
      return Promise.resolve();
    });
  const rows = vi.spyOn(selectors, 'readRows').mockImplementation(() => {
    if (filtered) {
      clock = 200;
      return Promise.resolve([]);
    }
    return Promise.resolve([
      {
        index: 0,
        username: fixture.items[0]!.account.handle!,
        text: fixture.items[0]!.text,
        age: '1w',
      },
    ]);
  });
  const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
  try {
    await expect(
      loadList(
        { goto: () => Promise.resolve() } as unknown as Page,
        fixture.items[0]!,
        fixture.items[0]!.account.handle!,
        { ...productionContext, responseMs: 100 },
        () => {},
        false,
        undefined,
        counts,
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_CHECK', token: 'list-timeout' });
    expect(counts.listTimeout).toMatchObject({
      rowsObserved: false,
      filter: {
        applied: true,
        readbackObserved: false,
        startMatches: false,
        endMatches: false,
      },
      dom: { observed: false, lastChangeAfterApplyMs: null },
      observationFailed: true,
    });
    expect(JSON.stringify(counts.listTimeout)).not.toContain(
      fixture.items[0]!.text,
    );
  } finally {
    rows.mockRestore();
    click.mockRestore();
    choices.mockRestore();
    outside.mockRestore();
    check.mockRestore();
    now.mockRestore();
  }
});

test.each(['p', 'reel'] as const)(
  'C26 observed %s addresses retain only the exact same-origin post kind and code',
  (kind) => {
    const origin = 'https://www.instagram.com';
    for (const suffix of ['', '/'])
      expect(
        postReopenTarget(
          `${origin}/${kind}/${IG_FIXTURE.code}${suffix}`,
          origin,
        ),
      ).toBe(`${origin}/${kind}/${IG_FIXTURE.code}`);
  },
);
test.each([
  'https://foreign.invalid/p/Generated_Aa-19',
  'https://www.instagram.com.foreign.invalid/p/Generated_Aa-19',
  'http://www.instagram.com/p/Generated_Aa-19',
  'https://user:password@www.instagram.com/p/Generated_Aa-19',
  'https://www.instagram.com/your_activity/interactions/comments',
  'https://www.instagram.com/accounts/login/',
  'https://www.instagram.com/explore/Generated_Aa-19',
  'https://www.instagram.com/p/Generated_Aa-19/c/123/',
  'https://www.instagram.com/p/Generated_Aa-19?query=1',
  'https://www.instagram.com/p/Generated_Aa-19#fragment',
  'https://www.instagram.com/p/%2Fforeign',
  'https://www.instagram.com/p/' + 'a'.repeat(65),
  '/p/Generated_Aa-19',
  'not-a-url',
])(
  'C26 invalid observed target %s cannot authorize a reopen navigation',
  async (target) => {
    const origin = 'https://www.instagram.com';
    expect(postReopenTarget(target, origin)).toBeNull();
    const goto = vi.fn();
    const check = vi.spyOn(selectors, 'checkPage').mockResolvedValue();
    try {
      await expect(
        reopenCandidate(
          { goto } as unknown as Page,
          target,
          { ...productionContext, origin },
          () => {},
        ),
      ).rejects.toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
        token: 'post-structure',
      });
      expect(goto).not.toHaveBeenCalled();
    } finally {
      check.mockRestore();
    }
  },
);

test.each([false, true])(
  'C20 failed read started after deadline=%s keeps the last sampled fields without another read',
  async (after) => {
    const fixture = await instagramFixture();
    const expected = fixture.items[0]!.account.handle!;
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const check = vi.spyOn(selectors, 'checkPage').mockImplementation(() => {
      if (after) clock = 200;
      return Promise.resolve();
    });
    const rows = vi.spyOn(selectors, 'readRows').mockResolvedValue([
      {
        index: 0,
        username: expected,
        text: fixture.items[0]!.text,
        age: '1w',
      },
    ]);
    const outside = vi
      .spyOn(selectors, 'outsideProfilePaths')
      .mockImplementation(() => {
        clock = 250;
        return Promise.resolve([]);
      });
    const page = {
      goto: () => {
        clock = 10;
        return Promise.resolve();
      },
    } as unknown as Page;
    try {
      const error = await loadList(
        page,
        fixture.items[0]!,
        expected,
        { ...productionContext, responseMs: 100 },
        () => {},
      ).catch((caught: unknown) => caught);
      expect(stopDetails(error)).toEqual({
        code: 'ACCOUNT_MISMATCH',
        token: 'account-changed',
        accountCheck: {
          profileLinkFound: false,
          outsidePathCount: 0,
          rows: 1,
          ownRows: 1,
          reads: 1,
          elapsedMs: 250,
          lastReadAfterDeadline: after,
        },
      });
      expect(outside).toHaveBeenCalledTimes(1);
      expect(rows).toHaveBeenCalledTimes(2);
      for (const value of [
        expected,
        fixture.items[0]!.text,
        ...Object.values(IG_FIXTURE.other),
      ])
        expect(JSON.stringify(stopDetails(error))).not.toContain(value);
    } finally {
      outside.mockRestore();
      rows.mockRestore();
      check.mockRestore();
      now.mockRestore();
    }
  },
);
test('C20 an exact match read after the deadline still follows the existing success-before-timeout order', async () => {
  const fixture = await instagramFixture(),
    expected = fixture.items[0]!.account.handle!;
  let clock = 0;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const check = vi.spyOn(selectors, 'checkPage').mockResolvedValue();
  const rows = vi
    .spyOn(selectors, 'readRows')
    .mockResolvedValue([
      { index: 0, username: expected, text: fixture.items[0]!.text, age: '1w' },
    ]);
  const outside = vi
    .spyOn(selectors, 'outsideProfilePaths')
    .mockImplementation(() => {
      clock = 200;
      return Promise.resolve([`/${expected}/`]);
    });
  const boundary = new Error('generated-filter-boundary');
  const click = vi.spyOn(selectors, 'clickAllowed').mockRejectedValue(boundary);
  const page = {
    goto: () => {
      clock = 10;
      return Promise.resolve();
    },
  } as unknown as Page;
  try {
    await expect(
      loadList(
        page,
        fixture.items[0]!,
        expected,
        { ...productionContext, responseMs: 100 },
        () => {},
      ),
    ).rejects.toBe(boundary);
    expect(click).toHaveBeenCalledTimes(1);
    expect(outside).toHaveBeenCalledTimes(1);
  } finally {
    click.mockRestore();
    outside.mockRestore();
    rows.mockRestore();
    check.mockRestore();
    now.mockRestore();
  }
});
