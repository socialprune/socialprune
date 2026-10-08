import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { xGuide } from '@socialprune/adapter-x/guide';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';
import en from '../src/i18n/en.json' with { type: 'json' };
import de from '../src/i18n/de.json' with { type: 'json' };
import { observeImport } from './helpers.ts';
import { checkAccessibility } from './accessibility.ts';

for (const [locale, messages] of [
  ['en', en],
  ['de', de],
] as const) {
  test(`GD platform choice at #/guide in ${locale}`, async ({
    page,
    context,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem('sp-locale', value),
      locale,
    );
    const audit = await observeImport(context, page);
    await page.goto('/socialprune/#/guide');
    await expect(page.locator('main[data-gate]')).toHaveAttribute(
      'data-gate',
      'ready',
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.workspace?.summary !== null &&
            window.socialprune !== undefined,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      messages['nav.guide'],
    );
    await expect(
      page.getByRole('heading', { name: messages['guide.choose'] }),
    ).toBeVisible();
    const choice = page.locator('section[data-guide-count]');
    await expect(
      choice.getByRole('link', { name: 'X', exact: true }),
    ).toHaveAttribute('href', '#/guide/x');
    await expect(
      choice.getByRole('link', { name: 'Instagram', exact: true }),
    ).toHaveAttribute('href', '#/guide/instagram');
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await checkAccessibility(page, context);
    await audit.assert();
    await choice.getByRole('link', { name: 'X', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByTestId('platform-guide')).toHaveAttribute(
      'data-platform',
      'x',
    );
  });

  for (const guide of [xGuide, instagramGuide]) {
    test(`GD #/guide/${guide.platform} data, calendar and 320px in ${locale}`, async ({
      page,
      context,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem('sp-locale', value),
        locale,
      );
      const audit = await observeImport(context, page);
      await page.goto(`/socialprune/#/guide/${guide.platform}`);
      await expect(page.locator('main[data-gate]')).toHaveAttribute(
        'data-gate',
        'ready',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.workspace?.summary !== null &&
              window.socialprune !== undefined,
          ),
        )
        .toBe(true);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      const view = page.getByTestId('platform-guide');
      await expect(view).toHaveAttribute('data-platform', guide.platform);
      const expected = [
        guide.startUrl,
        ...guide.steps,
        ...guide.options,
        guide.waiting,
        guide.downloadWindow,
        guide.htmlExportHint,
      ];
      for (const fact of expected)
        await expect(view.locator(`[data-fact-id="${fact.id}"]`)).toHaveText(
          fact.text[locale],
        );
      expect(
        await page
          .getByTestId('guide-steps')
          .evaluate((list) => getComputedStyle(list).listStyleType),
      ).toBe('decimal');
      await expect(
        page.getByTestId('guide-steps').locator(':scope > li'),
      ).toHaveCount(guide.steps.length + 1);
      await expect(page.getByTestId('guide-verification')).toHaveText(
        messages['guide.notChecked'],
      );
      await expect(
        view.getByRole('link', { name: messages['guide.report'] }),
      ).toHaveAttribute(
        'href',
        'https://github.com/socialprune/socialprune/issues/new',
      );
      // Sources are anchors, never fetched merely because a guide is displayed.
      await expect(
        view.getByRole('link', {
          name: new RegExp(locale === 'de' ? 'Hilfe öffnen' : '^Open .* help$'),
        }),
      ).toHaveAttribute(
        'href',
        locale === 'de'
          ? (guide.startUrl.sourceDe?.url ?? guide.startUrl.source.url)
          : guide.startUrl.source.url,
      );
      if (guide.paths) {
        await expect(
          view.getByRole('tab', { name: messages['guide.desktop'] }),
        ).toHaveAttribute('aria-selected', 'true');
        for (const fact of guide.paths.desktop)
          await expect(view.locator(`[data-fact-id="${fact.id}"]`)).toHaveText(
            fact.text[locale],
          );
        await view.getByRole('tab', { name: messages['guide.mobile'] }).click();
        for (const fact of guide.paths.mobile)
          await expect(view.locator(`[data-fact-id="${fact.id}"]`)).toHaveText(
            fact.text[locale],
          );
        await expect(
          view.getByRole('tab', { name: messages['guide.mobile'] }),
        ).toHaveAttribute('aria-selected', 'true');
      }
      await view
        .getByRole('combobox', { name: messages['guide.progress'] })
        .selectOption('1');
      await view.getByLabel(messages['guide.reminderDate']).fill('2026-11-12');
      const downloadPromise = page.waitForEvent('download');
      await view
        .getByRole('button', { name: messages['guide.reminder'] })
        .click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(
        `socialprune-${guide.platform}-reminder.ics`,
      );
      const file = await download.path();
      expect(file).not.toBeNull();
      const content = await readFile(file, 'utf8');
      expect(await download.failure()).toBeNull();
      expect(content.endsWith('\r\n')).toBe(true);
      expect(content.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
      for (const line of content.split('\r\n'))
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      const unfolded = content.replace(/\r\n[ \t]/g, '');
      expect(unfolded).toContain('DTSTART;VALUE=DATE:20261112\r\n');
      expect(unfolded).toContain('DTEND;VALUE=DATE:20261113\r\n');
      expect(unfolded).toMatch(
        /^UID:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@socialprune.github.io\r$/m,
      );
      expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      const platform =
        guide.platform === 'x'
          ? messages['guide.x']
          : messages['guide.instagram'];
      const summary = messages['guide.calendarSummary'].replace(
        '{platform}',
        platform,
      );
      const description = messages['guide.calendarDescription'].replace(
        '{url}',
        `https://socialprune.github.io/socialprune/#/guide/${guide.platform}`,
      );
      expect(
        unfolded
          .split('\r\n')
          .filter((line) => /^(SUMMARY|DESCRIPTION):/.test(line))
          .map((line) =>
            line.replace(/\\([\\,;nN])/g, (_, value: string) =>
              value.toLowerCase() === 'n' ? '\n' : value,
            ),
          ),
      ).toEqual([
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `DESCRIPTION:${summary}`,
      ]);
      expect(unfolded).toContain('TRIGGER;RELATED=START:PT9H\r\n');
      await page.setViewportSize({ width: 320, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await checkAccessibility(page, context);
      await audit.assert();
      await page.reload();
      await expect(page.getByLabel(messages['guide.reminderDate'])).toHaveValue(
        '2026-11-12',
      );
      await expect(
        page.getByRole('combobox', { name: messages['guide.progress'] }),
      ).toHaveValue('1');
    });
  }
}
