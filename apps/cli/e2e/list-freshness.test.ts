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
import { listRowDiagnostic } from '../src/browser/instagram/list-diagnostic.ts';
import {
  historicalListPage,
  historicalListRows,
} from './fake-instagram/list-reader-20261023.ts';
import { readRows, rowCandidate } from '../src/browser/instagram/selectors.ts';
import { listNavigationPage } from './fake-instagram/list-navigation-pages.ts';

test.each(['tiles', 'dialog', 'empty'] as const)(
  'IG-list page locations distinguish generated %s from navigation-only rows',
  async (mode) => {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const fixture = listNavigationPage(mode);
      await page.setContent(fixture.html);
      const diagnostic = await listRowDiagnostic(
        page,
        fixture.text,
        fixture.at,
        fixture.handle,
      );
      expect(diagnostic.observed).toBe(true);
      expect(diagnostic.page).toMatchObject({
        observed: true,
        observationFailed: false,
        knownEmptyStatePresent: mode === 'empty',
      });
      expect(diagnostic.page!.containers.navAside.links.yourActivity).toBe(3);
      expect(diagnostic.rows.slice(0, 3).map((row) => row.textLength)).toEqual([
        76, 74, 80,
      ]);
      expect(
        diagnostic.rows.slice(0, 3).map((row) => row.authorLength),
      ).toEqual([12, 6, 7]);
      for (const row of diagnostic.rows.slice(0, 3))
        expect(row).toMatchObject({
          container: 'main',
          shape: 'listitem',
          ancestry: {
            nav: true,
            aside: true,
            header: true,
            navigation: true,
            tablist: true,
            dialog: false,
          },
          singleLinkPathClass: 'your-activity',
          imagePresent: false,
          authorEqualsHandle: false,
          timeElementPresent: false,
        });
      if (mode === 'tiles')
        expect(diagnostic.page!.containers.main).toMatchObject({
          links: { post: 3 },
          images: 3,
          checkboxes: 1,
          scrollContainers: 1,
        });
      if (mode === 'dialog') {
        expect(diagnostic.page!.containers.dialog).toMatchObject({
          links: { post: 1 },
          images: 1,
          timeElements: 1,
          timesWithinWindow: 1,
          checkboxes: 1,
          handleElements: 1,
        });
        expect(
          diagnostic.rows.find((row) => row.container === 'dialog'),
        ).toMatchObject({
          ancestry: { dialog: true },
          singleLinkPathClass: 'post',
          imagePresent: true,
        });
      }
      if (mode === 'empty') {
        expect(diagnostic.total).toBe(7);
        for (const region of Object.values(diagnostic.page!.containers))
          expect(region).toMatchObject({
            links: { post: 0 },
            timeElements: 0,
            handleElements: 0,
            checkboxes: 0,
            scrollContainers: 0,
          });
        expect(
          diagnostic.rows.every(
            (row) =>
              !row.handleElementPresent &&
              !row.timeElementPresent &&
              !row.exportStartsWithCommentPrefix,
          ),
        ).toBe(true);
        const german = listNavigationPage('empty', true);
        await page.setContent(german.html);
        expect(
          (await listRowDiagnostic(page, german.text, german.at, german.handle))
            .page!.knownEmptyStatePresent,
        ).toBe(true);
      }
      for (const value of [
        fixture.handle,
        fixture.text,
        fixture.at,
        'Generated_post',
        'No results',
        'generatednav',
      ])
        expect(JSON.stringify(diagnostic)).not.toContain(value);
    } finally {
      await browser.close();
    }
  },
);

test.each(['old', 'split', 'foreign-first'] as const)(
  'IG-list historical 8ad968d and current reader agree on generated %s rows',
  async (layout) => {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const fixture = historicalListPage(layout);
      await page.setContent(fixture.html);
      const historical = await historicalListRows(page);
      const current = await readRows(page);
      expect(current).toEqual(historical);
      expect(
        current.filter(
          (row) =>
            row.username === fixture.own &&
            rowCandidate(row.text, fixture.text),
        ),
      ).toHaveLength(layout === 'split' ? 0 : 1);
      if (layout === 'foreign-first')
        expect(current.at(-1)?.username).toBe('generated_other');
      if (layout === 'split')
        expect(await page.locator('main li').count()).toBe(3);
    } finally {
      await browser.close();
    }
  },
);

test('IG-list link and element projection pins a later own-name link, truncation and non-datetime time without contents', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    const handle = 'generated_handle';
    const prefix = 'Generated target comment with a long prefix';
    const target = prefix + ' and more text';
    await page.setContent(
      `<main><li><a href="/foreign/">foreign</a> <a href="/${handle}/">${handle}</a> <span>${prefix}...</span> <time>1w</time></li><li><span>${handle.toUpperCase()}</span> <span>${target}</span> 2d</li><li><a role="link">foreign</a> unrelated 1w</li></main>`,
    );
    const result = await listRowDiagnostic(
      page,
      target,
      '2025-01-02T12:00:00Z',
      handle,
    );
    expect(result).toMatchObject({
      observed: true,
      total: 3,
      rows: [
        {
          anchorCount: 2,
          firstHandleAnchorIndex: 1,
          handleElementPresent: true,
          rowTextStartsWithHandle: false,
          trailingEllipsisPresent: true,
          timeElementPresent: true,
          exactTimeObserved: false,
        },
        {
          anchorCount: 0,
          firstHandleAnchorIndex: -1,
          handleElementPresent: true,
          rowTextStartsWithHandle: true,
          exportStartsWithCommentText: true,
          commentTextStartsWithExport: true,
          timeElementPresent: false,
        },
        {
          anchorCount: 1,
          firstHandleAnchorIndex: -1,
          handleElementPresent: false,
          rowTextStartsWithHandle: false,
          timeElementPresent: false,
        },
      ],
    });
    for (const value of [
      handle,
      prefix,
      target,
      'foreign',
      '/foreign/',
      '2025',
      '1w',
    ])
      expect(JSON.stringify(result)).not.toContain(value);
    const row = result.rows[0]!;
    const diagnostic = {
      observed: true,
      capped: false,
      total: 1,
      displayNameObserved: false,
      displayNameAmbiguous: false,
      rows: [row],
    };
    const { ListRowDiagnosticSchema } =
      await import('../src/browser/instagram/report.ts');
    expect(
      ListRowDiagnosticSchema.safeParse({
        ...diagnostic,
        rows: [{ ...row, firstHandleAnchorIndex: 2 }],
      }).success,
    ).toBe(false);
    expect(
      ListRowDiagnosticSchema.safeParse({
        ...diagnostic,
        rows: [{ ...row, handle: handle }],
      }).success,
    ).toBe(false);
  } finally {
    await browser.close();
  }
});

test('IG-list per-row projection separates a foreign display-name match, an ignored result and a nav image', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<nav><div role="button" aria-label="Generated nav"><img></div></nav><main><div role="button" aria-label="Generated display row"><img>Generated Display Generated target 1w</div><li><time datetime="2025-01-02T12:00:00Z"></time>Generated target</li></main>`,
    );
    const result = await listRowDiagnostic(
      page,
      'Generated target',
      '2025-01-02T12:00:00Z',
      'generated_handle',
      [
        {
          user: {
            username: 'generated_handle',
            full_name: 'Generated Display',
          },
        },
      ],
    );
    expect(result).toMatchObject({
      observed: true,
      total: 3,
      displayNameObserved: true,
      rows: [
        { container: 'elsewhere', textPresent: false, imagePresent: true },
        {
          container: 'main',
          authorEqualsHandle: false,
          authorEqualsDisplayName: true,
          commentTextEqualsExport: true,
        },
        {
          container: 'main',
          shape: 'listitem',
          textEqualsExport: true,
          exactTimeObserved: true,
          timestampWithinWindow: true,
        },
      ],
    });
    for (const forbidden of [
      'Generated',
      'generated_handle',
      '2025',
      'datetime',
      '1w',
    ])
      expect(JSON.stringify(result)).not.toContain(forbidden);
  } finally {
    await browser.close();
  }
});

test.each(['readable-retained', 'readable-repeated'] as const)(
  'IG-list a split-container %s result cannot exclude a comment through no-row',
  async (mode) => {
    const fixture = await instagramFixture(2);
    fixture.items[1]!.createdAt = new Date(
      Date.parse(fixture.items[0]!.createdAt) + 100 * 86400000,
    ).toISOString();
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.setToday('2026-10-29');
    fake.listFreshness(mode);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    const tracker = listFreshness();
    try {
      const page = await browser.newPage();
      const outcomes: unknown[] = [];
      for (const item of fixture.items) {
        const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
        outcomes.push(
          await loadList(
            page,
            item,
            item.account.handle!,
            { ...productionContext, origin: fake.origin, responseMs: 1500 },
            () => {},
            false,
            undefined,
            counts,
            tracker,
          ).catch((error: unknown) => error),
        );
        expect(counts.regions).toMatchObject({
          observed: true,
          main: 1,
          elsewhere: 1,
          distinctParents: 2,
        });
        expect(counts.emptySkipped).toBe(1);
      }
      expect(outcomes[mode === 'readable-retained' ? 0 : 1]).toMatchObject({
        code: 'PLATFORM_CHECK',
        token: 'list-timeout',
      });
      expect(
        fake.requests.some((request) => request.path.startsWith('/p/')),
      ).toBe(false);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

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
    await page.goto(fake.origin + `/p/${IG_FIXTURE.code}/`);
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
