import { expect, test } from '@playwright/test';
import {
  generatedReadPost,
  liveExpected,
  liveFeedFixture,
  restoreLiveFeed,
} from './feed-fixture.ts';
import {
  focusInstagramFixture,
  instagramStates,
} from './focus-instagram-fixture.ts';
import { checkAccessibility } from './accessibility.ts';

test('S3 real feed opening geometry at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await restoreLiveFeed(page, liveFeedFixture(), undefined, [
    generatedReadPost(),
  ]);
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption(liveExpected.instagram);
  await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
  const geometry = await page.getByRole('tabpanel').evaluate((panel) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        role: node.getAttribute('role'),
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        display: style.display,
        paddingTop: style.paddingTop,
        marginTop: style.marginTop,
        align: style.alignContent,
      };
    };
    const feed = panel.querySelector('[role="feed"]')!;
    return {
      panel: box(panel),
      scroll: panel.scrollTop,
      feed: box(feed),
      children: [...feed.children].map(box),
      articles: [...feed.querySelectorAll('article')].map((article) => ({
        id: article.getAttribute('data-card-id'),
        ...box(article),
        children: [...article.children].map(box),
      })),
    };
  });
  console.log('S3_BASE_GEOMETRY', JSON.stringify(geometry));
  const firstText = await page
    .getByRole('feed')
    .locator('article')
    .first()
    .locator('[data-instagram-comment] p')
    .first()
    .boundingBox();
  expect(firstText!.y - geometry.panel.top).toBeLessThanOrEqual(20);
});

for (const lang of ['de', 'en'])
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280])
      test(`S3 context and existing decisions ${lang} ${theme} ${width}`, async ({
        page,
        context,
        baseURL,
      }) => {
        test.setTimeout(120000);
        await page.setViewportSize({
          width,
          height: width === 1280 ? 800 : 844,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        const remote: string[] = [];
        page.on('request', (request) => {
          if (new URL(request.url()).origin !== new URL(baseURL!).origin)
            remote.push(request.url());
        });
        for (const state of instagramStates) {
          const { data, records } = focusInstagramFixture(state);
          await restoreLiveFeed(page, data, undefined, records);
          await page
            .getByRole('combobox', {
              name: lang === 'de' ? 'Konto' : 'Account',
              exact: true,
            })
            .selectOption(liveExpected.instagram);
          const article = page.getByRole('feed').locator('article').first();
          await expect(article).toContainText('Invented comment about the');
          if (records.length) {
            const image = article
              .getByTestId('instagram-post')
              .locator('img')
              .first();
            await expect(image).toBeVisible();
            await expect
              .poll(() =>
                image.evaluate(
                  (node) => (node as HTMLImageElement).naturalWidth,
                ),
              )
              .toBeGreaterThan(0);
            await image.evaluate((node) => (node as HTMLImageElement).decode());
          }
          // Context arrives after the feed window. Measure only the painted
          // media layout, not its preceding no-image placeholder height.
          await article.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          const actions = article.locator('[data-keep-action]').locator('..');
          const openingActions = await actions.boundingBox();
          const panelBox = await page.getByRole('tabpanel').boundingBox();
          expect(openingActions!.y).toBeGreaterThanOrEqual(panelBox!.y);
          expect(
            openingActions!.y + openingActions!.height,
          ).toBeLessThanOrEqual(panelBox!.y + panelBox!.height + 1);
          if (width !== 1280 && state !== 'missing-post')
            expect(
              openingActions!.y + openingActions!.height,
            ).toBeGreaterThanOrEqual(panelBox!.y + panelBox!.height - 1);
          const before = await article.evaluate((node) => ({
            article: node.getBoundingClientRect().top,
            first: node.firstElementChild!.getBoundingClientRect().top,
          }));
          expect(before.first - before.article).toBeLessThanOrEqual(20);
          if (records.length) {
            const image = article
              .getByTestId('instagram-post')
              .locator('img')
              .first();
            await expect(image).toBeVisible();
            const size = await image.evaluate((img) => ({
              width: img.getBoundingClientRect().width,
              height: img.getBoundingClientRect().height,
              natural: (img as HTMLImageElement).naturalWidth,
              parent: img.parentElement!.clientWidth,
            }));
            expect(size.width).toBe(Math.min(size.parent, 470));
            expect(size.height).toBeCloseTo(size.width, 1);
            if (width === 1280) {
              const layout = await actions.evaluate((node) => {
                const box = (element: Element) => {
                  const { left, right, top, bottom } =
                    element.getBoundingClientRect();
                  return { left, right, top, bottom };
                };
                const article = node.closest('article')!,
                  post = article.querySelector(
                    '[data-testid="instagram-post"]',
                  )!,
                  panel = article.closest('[role="tabpanel"]')!;
                return {
                  actions: box(node),
                  post: box(post),
                  panel: box(panel),
                };
              });
              expect(layout.actions.left).toBeGreaterThan(layout.post.right);
              expect(layout.actions.top).toBeGreaterThanOrEqual(
                layout.panel.top,
              );
              expect(layout.actions.bottom).toBeLessThanOrEqual(
                layout.panel.bottom,
              );
            }
            if (state === 'list')
              await expect(article.getByTestId('instagram-post')).toContainText(
                lang === 'de' ? 'Liste' : 'list',
              );
            if (state === 'missing-owner')
              await expect(article.getByTestId('instagram-post')).toContainText(
                lang === 'de' ? 'Export' : 'export',
              );
          } else
            await expect(article).toContainText(
              lang === 'de'
                ? 'Instagram liefert den Beitrag nicht mit.'
                : 'Instagram does not include the post.',
            );
          const ownComment = article
            .locator('[data-instagram-comment] > [class*="comment"] p')
            .first();
          await ownComment.evaluate(async (node) => {
            const panel = node.closest('[role="tabpanel"]')!;
            panel.scrollTop +=
              node.getBoundingClientRect().top -
              panel.getBoundingClientRect().top -
              12;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
          });
          const ownBox = await ownComment.boundingBox(),
            actionBox = await actions.boundingBox();
          expect(ownBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
          if (width !== 1280)
            expect(ownBox!.y + ownBox!.height).toBeLessThanOrEqual(
              actionBox!.y + 1,
            );
          await actions.scrollIntoViewIfNeeded();
          for (const button of await actions.getByRole('button').all()) {
            const box = await button.boundingBox();
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);
          }
          await article.locator('[data-keep-action]').click();
          await expect(article).toHaveAttribute('data-decision', 'keep');
          await article.focus();
          await article.press('u');
          await expect(article).toHaveAttribute('data-decision', 'undecided');
          await article.press('l');
          await expect(article).toHaveAttribute('data-decision', 'later');
          await article.press('m');
          await expect(article).toHaveAttribute('data-decision', 'delete');
          await article.press('u');
          await expect(article).toHaveAttribute('data-decision', 'undecided');
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          expect(
            await page.getByRole('feed').locator('article').count(),
          ).toBeLessThanOrEqual(300);
        }
        await checkAccessibility(page, context);
        expect(remote).toEqual([]);
      });
