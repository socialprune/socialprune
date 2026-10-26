import { expect, test } from 'vitest';
import { chromium } from 'playwright-core';
import { fakeInstagram } from './fake-instagram/server.ts';
import { instagramFixture } from './fake-instagram/fixture.ts';
import {
  loadList,
  productionContext,
} from '../src/browser/instagram/driver.ts';
import type { RowReadCounts } from '../src/browser/instagram/selectors.ts';
import { listFreshness } from '../src/browser/instagram/list-freshness.ts';
import { CONTEXT_PORTS } from './fake-instagram/ports.ts';
import { FilteredListTimeout } from '../src/browser/instagram/retry.ts';
import { listRegions } from '../src/browser/instagram/list-regions.ts';
import { commentLikes } from '../src/browser/instagram/likes.ts';
import { IG_FIXTURE } from './fake-instagram/fixture.ts';

test.each(['retained', 'sibling'] as const)(
  'C-list matching dropdowns with %s rows must stop, not exclude the comment',
  async (mode) => {
    const fixture = await instagramFixture();
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.listFreshness(mode);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    const page = await browser.newPage();
    const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
    try {
      const outcome = await loadList(
        page,
        fixture.items[0]!,
        fixture.items[0]!.account.handle!,
        { ...productionContext, origin: fake.origin, responseMs: 1500 },
        () => {},
        false,
        undefined,
        counts,
      ).catch((error: unknown) => error);
      expect(counts.listTimeout, String(outcome)).toMatchObject({
        rowContainers: 4,
        readableRows: 1,
        imageOnlyRows: 3,
        filter: {
          applied: true,
          readbackObserved: true,
          startMatches: true,
          endMatches: true,
        },
      });
      if (mode === 'sibling')
        expect(
          await page.locator('#generated-filter-result').innerText(),
        ).toContain(fixture.items[0]!.text);
      expect(counts.regions).toMatchObject({
        observed: true,
        main: 4,
        dialog: 0,
        elsewhere: 0,
        distinctParents: 1,
        ignoredTextMatches: mode === 'sibling' ? 1 : 0,
        ignoredDatedWindowMatches: mode === 'sibling' ? 1 : 0,
        ignoredDatedWindowRows: mode === 'sibling' ? 1 : 0,
        afterApply: {
          readbackObserved: false,
          startMatches: false,
          endMatches: false,
        },
      });
      expect(outcome).toMatchObject({
        code: 'PLATFORM_CHECK',
        token: 'list-timeout',
      });
      expect(outcome).not.toBeInstanceOf(FilteredListTimeout);
      expect(
        fake.requests.some((request) => request.path.startsWith('/p/')),
      ).toBe(false);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test('list-region correct refresh counts the selected main rows without ignored candidates', async () => {
  const fixture = await instagramFixture(1);
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
    const result = await loadList(
      page,
      fixture.items[0]!,
      fixture.items[0]!.account.handle!,
      { ...productionContext, origin: fake.origin, responseMs: 1500 },
      () => {},
      false,
      undefined,
      counts,
    );
    expect(result.candidates).toHaveLength(1);
    expect(counts.regions).toMatchObject({
      observed: true,
      main: 1,
      dialog: 0,
      elsewhere: 0,
      distinctParents: 1,
      ignoredTextMatches: 0,
      ignoredDatedWindowMatches: 0,
    });
  } finally {
    await browser.close();
    await fake.close();
  }
});

test('list-region reports main/dialog/elsewhere and post-Apply dropdown equality separately', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<main><div><div role="button" aria-label="Generated row">Generated target</div></div><div role="dialog"><button role="button" aria-label="Oldest to newest">Oldest to newest</button><span>Start date</span><select><option>January</option></select><select><option>1</option></select><select><option>2025</option></select><span>End date</span><select><option>January</option></select><select><option>3</option></select><select><option>2025</option></select></div></main><nav><div role="button" aria-label="Generated other row"></div></nav>`,
    );
    expect(
      await listRegions(page, 'Generated target', '2025-01-02T12:00:00.000Z'),
    ).toMatchObject({
      observed: true,
      main: 1,
      dialog: 1,
      elsewhere: 1,
      distinctParents: 3,
      afterApply: {
        readbackObserved: true,
        startMatches: true,
        endMatches: true,
      },
    });
    await page.locator('select').first().selectOption({ label: 'January' });
    expect(
      await listRegions(page, 'Generated target', '2025-02-02T12:00:00.000Z'),
    ).toMatchObject({
      afterApply: {
        readbackObserved: true,
        startMatches: false,
        endMatches: false,
      },
    });
  } finally {
    await browser.close();
  }
});

test('likes exact fake comment block supplies 17, not the other comment 999', async () => {
  const fixture = await instagramFixture(1);
  const item = fixture.items[0]!;
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  fake.likes('dom');
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(fake.origin + '/p/Generated0/');
    expect(
      await commentLikes(page, [], {
        id: IG_FIXTURE.commentId,
        createdAt: item.createdAt,
        username: item.account.handle!,
        text: item.text,
      }),
    ).toEqual({ count: 17, source: 'dom' });
  } finally {
    await browser.close();
    await fake.close();
  }
});

test('C-list a repeated opaque result for a different window stops on the second step', async () => {
  const fixture = await instagramFixture(2);
  fixture.items[1]!.createdAt = new Date(
    Date.parse(fixture.items[0]!.createdAt) + 100 * 86400000,
  ).toISOString();
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  fake.setToday('2026-10-25');
  fake.listFreshness('repeated');
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  const page = await browser.newPage();
  const freshness = listFreshness();
  const counts: RowReadCounts[] = [];
  try {
    const outcomes: unknown[] = [];
    for (const item of fixture.items) {
      const count: RowReadCounts = { emptySkipped: 0, otherName: 0 };
      counts.push(count);
      outcomes.push(
        await loadList(
          page,
          item,
          item.account.handle!,
          { ...productionContext, origin: fake.origin, responseMs: 1500 },
          () => {},
          false,
          undefined,
          count,
          freshness,
        ).catch((error: unknown) => error),
      );
    }
    expect(outcomes[0]).toMatchObject({ manualReason: 'list-image-only' });
    expect(outcomes[1]).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    expect(outcomes[1]).not.toBeInstanceOf(FilteredListTimeout);
    expect(counts[1]!.rowSignature).toEqual({
      observed: true,
      sameAsBeforeApply: false,
      sameAsPreviousStep: true,
      previousWindowDifferent: true,
    });
    expect(
      fake.requests.some((request) => request.path.startsWith('/p/')),
    ).toBe(false);
  } finally {
    await browser.close();
    await fake.close();
  }
});
