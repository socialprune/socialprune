import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import de from '../src/i18n/de.json' with { type: 'json' };
import {
  liveExpected,
  generatedReadPost,
  restoreLiveFeed,
  liveFeedFixture,
} from './feed-fixture.ts';
import { checkAccessibility } from './accessibility.ts';
const catalogs = { en, de };

test('a lazy post image reserves its box with wider German fallback metrics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'de'));
  await restoreLiveFeed(page, liveFeedFixture(), undefined, [
    generatedReadPost(),
  ]);
  await page.evaluate(() =>
    document.documentElement.style.setProperty(
      '--font-family',
      'Verdana, sans-serif',
    ),
  );
  await page
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption(liveExpected.instagram);
  const image = page.locator(
    `[data-item-id="${liveExpected.readComment}"] [data-testid="instagram-post"] img`,
  );
  // Do not scroll or eagerly load it to manufacture visibility. The unloaded
  // box must exist before the browser can choose to fetch its local resource.
  await expect(image).toBeVisible();
  expect((await image.boundingBox())!.height).toBeGreaterThan(0);
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(320);
});

test('Instagram screenshot fallback and both confirmation kinds keep their distinct evidence', async ({
  page,
}) => {
  const base = generatedReadPost();
  const cases = [
    {
      ...base,
      itemId: 'instagram:screenshot',
      image: { file: null, host: null, status: 'not-captured' as const },
      screenshot: {
        file: 'shot.jpg' as const,
        bytes: 2048,
        status: 'stored' as const,
      },
    },
    {
      ...base,
      itemId: 'instagram:list',
      confirmedBy: 'list' as const,
      comment: { id: null, createdAt: null, expandClicks: 0 },
    },
    {
      ...base,
      itemId: 'instagram:owner',
      ownerCheck: 'not-in-export' as const,
    },
  ];
  const data = liveFeedFixture();
  const template = data.items.find(
    (item) => item.id === liveExpected.readComment,
  )!;
  for (const record of cases) {
    data.items.push({
      ...structuredClone(template),
      id: record.itemId,
      reference: {
        ...template.reference,
        ownerHandle:
          record.ownerCheck === 'not-in-export' ? null : 'generated_owner',
      },
    });
  }
  data.counts.items = data.items.length;
  await restoreLiveFeed(page, data, undefined, cases);
  await page
    .getByRole('combobox', { name: 'Account', exact: true })
    .selectOption(liveExpected.instagram);
  await page.getByRole('tab', { name: /^All,/ }).click();
  const screenshot = page.locator('[data-item-id="instagram:screenshot"]');
  await screenshot.scrollIntoViewIfNeeded();
  await expect(screenshot.locator('img')).toHaveCount(0);
  await screenshot
    .getByRole('button', { name: 'Show screenshot', exact: true })
    .click();
  await expect(screenshot.locator('img')).toHaveAttribute(
    'src',
    /\/shot\.jpg$/,
  );
  await expect(screenshot.locator('img')).toBeVisible();
  const hide = screenshot.getByRole('button', {
    name: 'Hide screenshot',
    exact: true,
  });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  const controls = await hide.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  const screenshotLayout = await screenshot
    .getByTestId('instagram-post')
    .evaluate((post) => {
      const image = post.querySelector('img')!;
      return {
        width: image.getBoundingClientRect().width,
        height: image.getBoundingClientRect().height,
        natural: [image.naturalWidth, image.naturalHeight],
        captionTop: post
          .querySelector('[data-instagram-caption]')!
          .getBoundingClientRect().top,
        imageBottom: image.getBoundingClientRect().bottom,
        imageRight: image.getBoundingClientRect().right,
        captionLeft: post
          .querySelector('[data-instagram-caption]')!
          .getBoundingClientRect().left,
      };
    });
  expect(screenshotLayout.width).toBe(470);
  expect(screenshotLayout.height / screenshotLayout.width).toBeCloseTo(
    screenshotLayout.natural[1]! / screenshotLayout.natural[0]!,
    2,
  );
  // The screenshot is expanded inside a real review card, so its retained
  // caption remains beside it at this desktop viewport.
  expect(screenshotLayout.imageRight).toBeLessThan(
    screenshotLayout.captionLeft,
  );
  await hide.click();
  await expect(
    screenshot.getByRole('button', { name: 'Show screenshot', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(screenshot.locator('img')).toHaveCount(0);
  const list = page.locator('[data-item-id="instagram:list"]');
  await expect(list).toContainText('no comment ID was recorded');
  await list.locator('summary').click();
  await expect(list).toContainText('The post itself did not show the comment.');
  const owner = page.locator('[data-item-id="instagram:owner"]');
  await owner.locator('summary').click();
  await expect(owner).toContainText('The export names no post account');
  await expect(owner).not.toContainText("the post's account match your export");
});

for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 1280])
      test(`Instagram structure, focus and decisions ${lang} ${theme} ${width}`, async ({
        page,
        context,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        await restoreLiveFeed(page, liveFeedFixture(), undefined, [
          generatedReadPost(),
        ]);
        await page
          .getByRole('combobox', {
            name: catalogs[lang]['review.account'],
            exact: true,
          })
          .selectOption(liveExpected.instagram);
        const read = page.locator(
          `[data-item-id="${liveExpected.readComment}"]`,
        );
        const post = read.getByTestId('instagram-post');
        await expect(post).toContainText(liveExpected.caption);
        await expect(post.locator('img')).toBeVisible();
        await post.locator('img').scrollIntoViewIfNeeded();
        const layout = await post.evaluate((node) => {
          const image = node.querySelector('img')!,
            header = node.querySelector('[data-instagram-post-header]')!,
            caption = node.querySelector('[data-instagram-caption]')!,
            avatar = node.querySelector('[data-instagram-post-avatar]')!;
          return {
            header: header.getBoundingClientRect().bottom,
            imageTop: image.getBoundingClientRect().top,
            imageBottom: image.getBoundingClientRect().bottom,
            imageRight: image.getBoundingClientRect().right,
            captionLeft: caption.getBoundingClientRect().left,
            caption: caption.getBoundingClientRect().top,
            imageWidth: image.getBoundingClientRect().width,
            imageHeight: image.getBoundingClientRect().height,
            contentWidth: image.parentElement!.clientWidth,
            natural: [image.naturalWidth, image.naturalHeight],
            avatar: {
              radius: getComputedStyle(avatar).borderRadius,
              border: getComputedStyle(avatar).borderTopWidth,
              width: avatar.getBoundingClientRect().width,
              height: avatar.getBoundingClientRect().height,
            },
          };
        });
        if (width === 320) {
          expect(layout.header).toBeLessThanOrEqual(layout.imageTop);
          expect(layout.imageBottom).toBeLessThanOrEqual(layout.caption);
        } else expect(layout.imageRight).toBeLessThan(layout.captionLeft);
        expect(layout.imageWidth).toBe(Math.min(layout.contentWidth, 470));
        expect(layout.imageHeight / layout.imageWidth).toBeCloseTo(
          layout.natural[1]! / layout.natural[0]!,
          2,
        );
        expect(layout.avatar.radius).toBe('50%');
        expect(layout.avatar.border).toBe('1px');
        expect(layout.avatar.width).toBe(layout.avatar.height);
        await expect(read.locator('[data-instagram-owner]')).toBeHidden();
        await expect(
          page.locator(
            '[data-item-id="instagram:feed-comment"] [data-instagram-owner]',
          ),
        ).toBeVisible();
        const positions = await read.evaluate((article) => ({
          post: article
            .querySelector('[data-instagram-caption]')!
            .getBoundingClientRect().bottom,
          comment: article
            .querySelector('[data-instagram-comment] > div:last-child')!
            .getBoundingClientRect().top,
        }));
        expect(positions.post).toBeLessThan(positions.comment);
        await expect(page.getByRole('feed')).not.toContainText(
          lang === 'en' ? 'Likes:' : 'Gefällt mir:',
        );
        await expect(page.getByRole('feed')).not.toContainText(
          /reposts|Reposts/,
        );
        await expect(page.getByRole('feed')).toContainText(
          catalogs[lang]['proto.instagramMissingPost'],
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await read.focus();
        await expect(read).toBeFocused();
        expect(
          await read.evaluate((node) => getComputedStyle(node).outlineWidth),
        ).toBe('3px');
        await page
          .getByRole('tab', {
            name: new RegExp(`^${catalogs[lang]['reviewFeed.tab.all']},`),
          })
          .click();
        await expect(page.getByRole('feed')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await read.focus();
        for (const [key, value] of [
          ['k', 'keep'],
          ['u', 'undecided'],
          ['l', 'later'],
          ['m', 'delete'],
          ['u', 'undecided'],
        ]) {
          await read.press(key!);
          await expect(read).toHaveAttribute('data-decision', value!);
          await expect(read).toBeFocused();
        }
        await post.locator('summary').click();
        await expect(post).toContainText(
          lang === 'en' ? 'Its text, time' : 'Text, Zeit',
        );
        await checkAccessibility(page, context);
      });
