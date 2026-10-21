import { expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { loadList, productionContext } from './driver.ts';
import * as selectors from './selectors.ts';
import { stopDetails } from './report.ts';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';

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
