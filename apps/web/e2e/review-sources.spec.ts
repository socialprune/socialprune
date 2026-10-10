import { test, expect } from '@playwright/test';
import { restoreReview, reviewFixture } from './review-fixture.ts';
import { observeImport } from './helpers.ts';
import { german } from './navigation.ts';

for (const locale of ['en', 'de'] as const) {
  test(`${locale} current row sources are capped at eight and labelled overflow comes through shared rows`, async ({
    page,
    context,
  }) => {
    const audit = await observeImport(context, page);
    const fixture = reviewFixture('demo', false);
    fixture.assessments = Array.from({ length: 11 }, (_, index) => ({
      assessmentId: `source-${index}`,
      submissionId: null,
      itemId: fixture.items[0]!.id,
      source: {
        kind: 'fixture',
        name: `Example source ${index.toString().padStart(2, '0')}`,
        version: '1',
      },
      category: 'unclear',
      risk: 1,
      reason: 'Invented source-cap example.',
      evidence: null,
      confidence: null,
      createdAt: fixture.createdAt,
    }));
    fixture.counts.assessments = fixture.assessments.length;
    await restoreReview(page, fixture);
    if (locale === 'de') await german(page);
    const row = page.getByRole('row').first();
    await expect(
      row.getByText(locale === 'de' ? 'Beispiel' : 'Example', { exact: true }),
    ).toHaveCount(8);
    await expect(
      row.locator('[aria-label]').filter({ hasText: '+3' }),
    ).toHaveAttribute(
      'aria-label',
      locale === 'de'
        ? '3 weitere Quellen von Vorschlägen'
        : '3 more suggestion sources',
    );
    const requests = await page.evaluate(async () => {
      const accountKey = window.workspace.summary!.accounts[0]!.key;
      await window.workspace.request({
        type: 'query',
        requestId: crypto.randomUUID(),
        queryId: 'sources-check',
        generation: 1,
        accountKey,
        filter: {},
        sort: [{ by: 'createdAt', direction: 'desc' }],
        search: '',
      });
      return window.workspace.request({
        type: 'window',
        requestId: crypto.randomUUID(),
        queryId: 'sources-check',
        generation: 1,
        offset: 0,
        limit: 1,
      });
    });
    expect(requests).toMatchObject({
      type: 'rows',
      rows: [
        {
          sources: fixture.assessments.slice(0, 8).map(({ source }) => source),
          moreSources: 3,
        },
      ],
    });
    await audit.assert();
  });
}
