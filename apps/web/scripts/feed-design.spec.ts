import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generatedPostImage,
  generatedPostScreenshot,
} from '../e2e/feed-fixture.ts';

test.beforeEach(async ({ page }) => {
  await page.route('**/context/instagram/Generated_design/image.png', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: generatedPostImage }),
  );
  await page.route('**/context/instagram/Generated_design/shot.jpg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: generatedPostScreenshot,
    }),
  );
});

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'])
    for (const width of [320, 1280])
      for (const screenshotOnly of [false, true])
        test(`Instagram ${screenshotOnly ? 'screenshot' : 'before/after'} gallery ${lang} ${theme} ${width}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 960 });
          for (const kind of [
            'x',
            'image',
            'screenshot',
            'list',
            'unread',
            'owner',
            'long',
          ]) {
            if (screenshotOnly && kind !== 'screenshot') continue;
            for (const before of [true, false]) {
              await page.goto(
                `/feed-design.html?surface=instagram-gallery&case=${kind}&lang=${lang}&theme=${theme}&before=${before}`,
              );
              const card = page.getByTestId('feed-card');
              await expect(card).toBeVisible();
              if (kind === 'screenshot') {
                await expect(card.locator('img')).toHaveCount(0);
                await card
                  .getByRole('button', {
                    name:
                      lang === 'de' ? 'Screenshot zeigen' : 'Show screenshot',
                    exact: true,
                  })
                  .click();
                await expect(
                  card.getByRole('button', {
                    name:
                      lang === 'de'
                        ? 'Screenshot ausblenden'
                        : 'Hide screenshot',
                    exact: true,
                  }),
                ).toHaveAttribute('aria-expanded', 'true');
              }
              if (!before && kind !== 'x') {
                await expect(card).not.toContainText(
                  /Reposts|reposts|Likes:|Gefällt mir:/,
                );
                if (kind !== 'unread') await card.locator('summary').click();
                const owner = card.locator('[data-instagram-owner]');
                if (kind === 'unread') await expect(owner).toBeVisible();
                else await expect(owner).toBeHidden();
              }
              await page.locator('img').evaluateAll(async (images) => {
                await Promise.all(
                  images.map((image) => {
                    (image as HTMLImageElement).loading = 'eager';
                    return (image as HTMLImageElement).decode();
                  }),
                );
              });
              expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
              ).toBeLessThanOrEqual(width);
              const bounds = await card.evaluate((article) => ({
                bottom: Math.max(
                  article.getBoundingClientRect().bottom,
                  ...[...article.querySelectorAll('button')].map(
                    (button) => button.getBoundingClientRect().bottom,
                  ),
                ),
                page: document.documentElement.scrollHeight,
              }));
              expect(bounds.bottom).toBeLessThanOrEqual(bounds.page + 1);
              await page.screenshot({
                fullPage: true,
                path: `${directory}/pairs/${kind}-${lang}-${theme}-${width}-${before ? 'before' : 'after'}.png`,
              });
            }
          }
        });

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'])
    for (const width of [320, 1280])
      test(`Instagram read and missing post ${lang} ${theme} ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(
          `/feed-design.html?lang=${lang}&theme=${theme}&platform=instagram`,
        );
        const read = page.getByRole('feed').locator('article').first();
        const missing = page.getByRole('feed').locator('article').nth(1);
        await expect(
          read.getByTestId('instagram-post').locator('img'),
        ).toBeVisible();
        await expect(read).toContainText(
          lang === 'de' ? 'Nachbarschaftsgarten' : 'neighbourhood garden',
        );
        await expect(missing).toContainText(
          lang === 'de'
            ? 'Instagram liefert den Beitrag nicht mit.'
            : 'Instagram does not include the post.',
        );
        await expect(read).not.toContainText(
          lang === 'de' ? 'Reposts' : 'reposts',
        );
        await expect(read).not.toContainText(
          lang === 'de' ? 'Gefällt mir:' : 'Likes:',
        );
        await page.screenshot({
          path: `${folder}/instagram-read-${lang}-${theme}-${width}.png`,
        });
        await missing.evaluate((element) =>
          element.scrollIntoView({ block: 'start' }),
        );
        await page.screenshot({
          path: `${folder}/instagram-missing-${lang}-${theme}-${width}.png`,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      });

const directory =
  // eslint-disable-next-line no-restricted-properties -- Test-only output directory explicitly chosen by the operator, never a credential.
  process.env['SP_FEED_DESIGN_DIR'] ??
  join(tmpdir(), 'socialprune-feed-w3b', 'design');
const folder = join(directory, 'screens', 'revision');
const tabs = [
  ['suggested', 'Löschvorschläge', 'Suggested for deletion'],
  ['held', 'Von deinen Regeln zurückgehalten', 'Held back by your rules'],
  ['kept', 'Behalten', 'Kept'],
  ['unclear', 'Unklar', 'Unclear'],
  ['marked', 'Vorgemerkt', 'Marked'],
  ['all', 'Alle', 'All'],
] as const;

for (const theme of ['light', 'dark'])
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
    [320, 640],
  ] as const) {
    test(`revision opening and unobscured scrolling ${theme} ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/feed-design.html?lang=de&theme=${theme}`);
      const panel = page.getByRole('tabpanel');
      const first = page.getByRole('feed').locator('article').first();
      const footer = page.locator('footer');
      const bounds = await first.evaluate((article) => {
        const rect = (element: Element) => {
          const { x, y, width, height, top, right, bottom, left } =
            element.getBoundingClientRect();
          return { x, y, width, height, top, right, bottom, left };
        };
        return {
          card: rect(article),
          byline: rect(article.querySelector('[id$="-byline"]')!),
          text: rect(article.querySelector('p[class*="postText"]')!),
          suggestion: rect(
            article.querySelector('div[class*="suggestionLine"]')!,
          ),
          actions: rect(article.querySelector('div[class*="actions"]')!),
        };
      });
      const top = (await footer.boundingBox())!.y;
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(bounds.card.right).toBeLessThanOrEqual(width);
      expect(bounds.byline.y).toBeGreaterThanOrEqual(0);
      expect(bounds.text.bottom).toBeLessThanOrEqual(top);
      expect(bounds.suggestion.bottom).toBeLessThanOrEqual(top);
      if (width === 1280) {
        expect(bounds.card.bottom).toBeLessThanOrEqual(top);
        expect(bounds.actions.bottom).toBeLessThanOrEqual(top);
      }
      console.log(
        'REVISION_OPENING',
        JSON.stringify({ width, height, theme, footerTop: top, ...bounds }),
      );
      await page.screenshot({
        path: `${folder}/review-opening-de-${theme}-${width}x${height}.png`,
      });
      const tabRows = await page
        .getByRole('tab')
        .evaluateAll((items) =>
          items.map((item) => item.getBoundingClientRect().y),
        );
      expect(new Set(tabRows).size).toBe(1);
      for (const index of [1, 3]) {
        await page
          .getByRole('feed')
          .locator('article')
          .nth(index)
          .evaluate((article) => article.scrollIntoView({ block: 'start' }));
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect((await footer.boundingBox())!.y).toBe(top);
        const cardTop = (await page
          .getByRole('feed')
          .locator('article')
          .nth(index)
          .boundingBox())!.y;
        expect(cardTop).toBeGreaterThanOrEqual((await panel.boundingBox())!.y);
        expect(cardTop).toBeLessThan((await panel.boundingBox())!.y + 32);
        await page.screenshot({
          path: `${folder}/review-after-${index}-cards-de-${theme}-${width}x${height}.png`,
        });
      }
      await panel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const lastBottom = await page
        .getByRole('feed')
        .locator('article')
        .last()
        .evaluate((element) => element.getBoundingClientRect().bottom);
      expect(lastBottom).toBeLessThanOrEqual(top);
      const clearance = await panel.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingBottom),
      );
      expect(clearance).toBeGreaterThanOrEqual(
        (await footer.boundingBox())!.height,
      );
      await page
        .getByRole('button', { name: 'Kriterien & Regeln', exact: true })
        .click();
      const editor = page.locator('[data-editor-scroll]');
      const editorFooter = page.locator('[data-editor-footer]');
      await page.screenshot({
        path: `${folder}/criteria-opening-de-${theme}-${width}x${height}.png`,
      });
      await page
        .getByRole('checkbox')
        .nth(8)
        .evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const control = page.getByRole('checkbox').nth(8);
      expect(
        (await control.boundingBox())!.y +
          (await control.boundingBox())!.height,
      ).toBeLessThan((await editorFooter.boundingBox())!.y);
      await page.screenshot({
        path: `${folder}/criteria-middle-de-${theme}-${width}x${height}.png`,
      });
      await page.getByText('So wirken deine Regeln', { exact: true }).click();
      await editor.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const ending = page.getByText(
        'Reposts und Instagram-Kommentare haben hier keine eigene',
        { exact: false },
      );
      expect(
        (await ending.boundingBox())!.y + (await ending.boundingBox())!.height,
      ).toBeLessThanOrEqual((await editorFooter.boundingBox())!.y);
      expect(
        await editor.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingBottom),
        ),
      ).toBeGreaterThanOrEqual((await editorFooter.boundingBox())!.height);
      await page.screenshot({
        path: `${folder}/criteria-end-de-${theme}-${width}x${height}.png`,
      });
    });
  }

test('revision final ADR states and Instagram surface', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['held', 'kept', 'unclear', 'all']) {
    await page.goto(`/feed-design.html?lang=de&theme=light&tab=${tab}`);
    await expect(
      page.getByRole('button', { name: /Trotzdem vormerken/ }).first(),
    ).toBeAttached();
  }
  await page.goto('/feed-design.html?lang=de&theme=dark&first=true');
  await expect(
    page.getByRole('heading', { name: 'Wähle zuerst, was weg soll.' }),
  ).toBeVisible();
  await expect(page.locator('footer')).toHaveCount(0);
  await page.screenshot({ path: `${folder}/first-start-de-dark-390x844.png` });
  await page
    .getByRole('button', { name: 'Kriterien wählen', exact: true })
    .click();
  expect(
    await page
      .locator('fieldset')
      .first()
      .getByRole('checkbox')
      .evaluateAll(
        (items) =>
          items.filter((item) => (item as HTMLInputElement).checked).length,
      ),
  ).toBe(0);
  await expect(
    page.getByText('Frühere Kategorie', { exact: true }).first(),
  ).toBeAttached();
  await expect(
    page.getByText('Kein Platz: entferne zuerst eine frühere Kategorie.'),
  ).toBeAttached();
  for (const theme of ['light', 'dark']) {
    await page.goto(
      `/feed-design.html?lang=de&theme=${theme}&platform=instagram`,
    );
    await expect(page.locator('footer')).toContainText(
      'Auf Instagram wird dabei noch nichts gelöscht.',
    );
    await page.screenshot({
      path: `${folder}/instagram-suggestion-de-${theme}-390x844.png`,
    });
    await page.goto(
      `/feed-design.html?lang=de&theme=${theme}&platform=instagram&tab=marked`,
    );
    await expect(
      page.getByRole('button', { name: 'Klickliste öffnen' }),
    ).toBeVisible();
    await page.screenshot({
      path: `${folder}/instagram-marked-de-${theme}-390x844.png`,
    });
    await page.goto(
      `/feed-design.html?lang=de&theme=${theme}&platform=instagram&surface=preview`,
    );
    await expect(page.getByRole('dialog')).toContainText(
      'Du löschst sie danach mit der Klickliste.',
    );
    await page.screenshot({
      path: `${folder}/instagram-preview-de-${theme}-390x844.png`,
    });
  }
});

for (const locale of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280]) {
      test(`${locale} ${theme} ${width}: every tab, picker, rules, preview and states`, async ({
        page,
        context,
        baseURL,
      }) => {
        await page.setViewportSize({ width, height: 960 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        const errors: string[] = [],
          remote: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        context.on('request', (request) => {
          if (new URL(request.url()).origin !== baseURL)
            remote.push(request.url());
        });
        await page.goto(`/feed-design.html?lang=${locale}&theme=${theme}`);
        await expect(page.getByRole('feed')).toBeVisible();
        await page.screenshot({
          path: `${folder}/opening-${locale}-${theme}-${width}.png`,
        });
        for (const [tab, german, english] of tabs) {
          await page
            .getByRole('tab', {
              name: new RegExp(`^${locale === 'de' ? german : english},`),
            })
            .click();
          await expect(
            page.getByRole('feed').locator('article').first(),
          ).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `${folder}/feed-${tab}-${locale}-${theme}-${width}.png`,
            fullPage: false,
          });
        }
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Kriterien & Regeln' : 'Criteria & rules',
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('heading', {
            name: locale === 'de' ? 'Was soll weg?' : 'What should go?',
          }),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `${folder}/criteria-rules-${locale}-${theme}-${width}.png`,
          fullPage: false,
        });
        await page
          .getByRole('textbox', {
            name: locale === 'de' ? 'Name' : 'Name',
            exact: true,
          })
          .fill(locale === 'de' ? 'Alter Arbeitgeber' : 'Old employer');
        await page
          .getByRole('textbox', {
            name:
              locale === 'de'
                ? 'Wonach sollen die Vorschläge suchen?'
                : 'What should the suggestions look for?',
          })
          .fill(
            locale === 'de'
              ? 'Witze über meinen früheren Arbeitsplatz.'
              : 'Jokes about my former workplace.',
          );
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Kriterium hinzufügen' : 'Add criterion',
          })
          .click();
        await expect(
          page.getByText(
            locale === 'de'
              ? 'Eigenes Kriterium, nicht gemessen'
              : 'Your own criterion, not measured',
            { exact: true },
          ),
        ).toBeVisible();
        await page
          .getByRole('textbox', { name: 'Name', exact: true })
          .fill('10 likes');
        await expect(
          page.getByText(
            locale === 'de'
              ? 'Das klingt nach einer Grenze. Als Regel anlegen?'
              : 'This sounds like a limit. Add it as a rule?',
          ),
        ).toBeVisible();
        await page.screenshot({
          path: `${folder}/criteria-own-rule-offer-${locale}-${theme}-${width}.png`,
          fullPage: false,
        });
        await page.getByRole('button', { name: 'Feed', exact: true }).click();
        await page
          .getByRole('tab', {
            name: new RegExp(
              `^${locale === 'de' ? 'Löschvorschläge' : 'Suggested for deletion'},`,
            ),
          })
          .click();
        const first = page.getByRole('feed').locator('article').first();
        await first.focus();
        await page.keyboard.press('j');
        await expect(first).toHaveAttribute('data-decision', 'undecided');
        await page.keyboard.press('k');
        await expect(first).toHaveAttribute('data-decision', 'keep');
        await expect(first).toBeFocused();
        await first
          .getByRole('button', {
            name: locale === 'de' ? /Zurück auf Offen/ : /Back to undecided/,
          })
          .click();
        await expect(first).toHaveAttribute('data-decision', 'undecided');
        await page
          .getByRole('button', {
            name:
              locale === 'de'
                ? /Einträge zum Löschen vormerken/
                : /Mark .* entries for deletion/,
          })
          .click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.locator('summary').click();
        await page.screenshot({
          path: `${folder}/preview-${locale}-${theme}-${width}.png`,
        });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(
          page.getByRole('button', {
            name:
              locale === 'de'
                ? /Einträge zum Löschen vormerken/
                : /Mark .* entries for deletion/,
          }),
        ).toBeFocused();
        await page
          .getByRole('button', {
            name: locale === 'de' ? 'Alle Zustände' : 'All states',
            exact: true,
          })
          .click();
        await page.screenshot({
          path: `${folder}/states-${locale}-${theme}-${width}.png`,
          fullPage: false,
        });
        for (const [state, label] of [
          ['loading', locale === 'de' ? 'Laden' : 'Loading'],
          ['empty', locale === 'de' ? 'Leer' : 'Empty'],
          ['error', locale === 'de' ? 'Fehler' : 'Error'],
        ] as const) {
          await page.getByRole('button', { name: label, exact: true }).click();
          await page.screenshot({
            path: `${folder}/state-${state}-${locale}-${theme}-${width}.png`,
            fullPage: false,
          });
        }
        expect(errors).toEqual([]);
        expect(remote).toEqual([]);
        expect(await page.locator('style').count()).toBe(0);
      });
    }

test('focus, strict policy, forced colors and changed preview', async ({
  page,
}) => {
  await page.goto('/feed-design.html?lang=en&theme=light');
  const selected = page.getByRole('tab', { selected: true });
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: /^Held back by your rules,/ }),
  ).toBeFocused();
  await expect(page.getByRole('button', { name: /Mark anyway/ })).toBeVisible();
  await page.getByRole('button', { name: 'All states', exact: true }).click();
  await page
    .getByRole('button', { name: 'Changed preview', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toContainText('New suggestions');
  await page.screenshot({
    path: `${folder}/preview-changed-en-light-1280.png`,
  });
  for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  for (const [state, label] of [
    ['loading', 'Loading'],
    ['error', 'Error'],
  ] as const) {
    await page
      .getByRole('button', { name: `Open preview: ${label}`, exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: /^Mark 3,812 entries$/ }),
    ).toBeDisabled();
    await page.screenshot({
      path: `${folder}/preview-${state}-en-light-1280.png`,
    });
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.screenshot({
    path: `${folder}/audit-forced-colors-en-1280.png`,
    fullPage: false,
  });
});

test('rendered craft floor at intermediate width and large text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 960 });
  await page.goto('/feed-design.html?lang=en&theme=light');
  const metrics = await page
    .getByRole('feed')
    .locator('article')
    .first()
    .evaluate((article) => {
      const text = article.querySelector('p[class*="postText"]')!;
      const style = getComputedStyle(text);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        buttons: [...article.querySelectorAll('button')].map((button) => ({
          text: button.textContent,
          height: button.getBoundingClientRect().height,
          width: button.getBoundingClientRect().width,
        })),
      };
    });
  expect(metrics.fontSize).toBeGreaterThanOrEqual(16);
  expect(metrics.lineHeight).toBeGreaterThanOrEqual(24);
  for (const button of metrics.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.width).toBeGreaterThanOrEqual(44);
  }
  console.log('CRAFT_METRICS', JSON.stringify(metrics));
  await page.screenshot({
    path: `${folder}/audit-intermediate-en-light-768.png`,
    fullPage: false,
  });
  await page
    .getByRole('button', { name: 'Criteria & rules', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('A deliberately long invented criterion for a wrapping check');
  await page
    .getByRole('textbox', { name: 'What should the suggestions look for?' })
    .fill('Invented content only. '.repeat(10));
  await page
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 960 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: `${folder}/audit-long-criterion-en-light-320.png`,
    fullPage: false,
  });
});
