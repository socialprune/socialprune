import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import { headerFixture } from './header-style.ts';
import { generatedReadPost, restoreLiveFeed } from './feed-fixture.ts';
import { generatedOriginal } from './original-text-fixture.ts';

const sizes = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1536, height: 730 },
  { width: 1920, height: 900 },
  { width: 390, height: 844 },
];
const shapes = [
  'short',
  '280',
  'image',
  'reply',
  'long',
  'tall',
  'wide',
] as const;
type Shape = (typeof shapes)[number];

async function prepare(page: Page, shape: Shape) {
  await page.goto('about:blank');
  const data = headerFixture();
  const instagram = shape === 'tall' || shape === 'wide';
  data.settings.review!.accountKey = instagram ? 'instagram:feed' : 'x:feed';
  data.settings.review!.feed!.tab = 'all';
  const item = data.items.find((item) =>
    instagram ? item.id === 'instagram:feed-read' : item.id === 'x:feed-1',
  )!;
  item.createdAt = '2025-01-31T00:00:00.000Z';
  item.text =
    shape === 'long'
      ? 'A generated council discussion with a long explanation. '.repeat(120)
      : shape === '280'
        ? 'A generated council discussion about the local park and its new paths. '
            .repeat(4)
            .slice(0, 280)
        : 'A generated council discussion about the park.';
  if (shape === 'reply' || shape === 'image') {
    item.kind = 'reply';
    item.reference.replyToId = '81001';
    item.reference.replyToHandle = 'generated_author';
  }
  const image = Buffer.from(
    await page.evaluate((shape) => {
      const canvas = document.createElement('canvas');
      canvas.width = shape === 'wide' ? 900 : 320;
      canvas.height = shape === 'tall' ? 900 : 320;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#7e9b87';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#f4eee2';
      context.beginPath();
      context.arc(150, 150, 60, 0, Math.PI * 2);
      context.fill();
      return canvas.toDataURL('image/png').split(',')[1]!;
    }, shape),
    'base64',
  );
  await page.route('**/context/instagram/**/image.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: image }),
  );
  await page.route('**/originals/81001/1.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: image }),
  );
  await restoreLiveFeed(
    page,
    data,
    undefined,
    instagram ? [generatedReadPost()] : [],
  );
  if (shape === 'reply' || shape === 'image') {
    const original = generatedOriginal({
      text: 'The generated original asks how the council should change the park. '.repeat(
        8,
      ),
      media:
        shape === 'image'
          ? [
              {
                n: 1,
                source: 'anonymous',
                kind: 'photo',
                status: 'stored',
                file: '1.png',
                altText: 'Generated park image',
                url: null,
                poster: null,
                bytes: 100,
                durationMs: null,
                bitrateLabel: null,
              },
            ]
          : [],
    });
    await page.evaluate((original) => {
      window.workspace.getOriginals = () => Promise.resolve([original]);
    }, original);
    await page.getByRole('tab', { name: /^Suggested for deletion,/ }).click();
    await page.getByRole('tab', { name: /^All,/ }).click();
  }
  return item.id;
}

async function mode(page: Page, single: boolean) {
  if (
    (await page.getByTestId('card-review').getAttribute('data-single')) ===
    String(single)
  )
    return;
  if (page.viewportSize()!.width > 540) {
    await page
      .getByRole('button', {
        name: single ? 'One at a time' : 'List',
        exact: true,
      })
      .click();
  } else {
    await page
      .getByRole('button', { name: 'Review options', exact: true })
      .click();
    await page
      .getByRole('menuitem', {
        name: single ? 'One at a time' : 'All',
        exact: true,
      })
      .click();
  }
}

async function expectStoredImage(image: Locator, pathname: string) {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node, pathname) => {
        const image = node as HTMLImageElement;
        return (
          image.isConnected &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          new URL(image.currentSrc).pathname === pathname
        );
      }, pathname),
    )
    .toBe(true);
}

async function geometry(page: Page, expanded = false) {
  const card = page.getByRole('feed').locator('article').first();
  await expect(card.locator('[data-mark-action]')).toBeVisible();
  const media = card.locator('[data-testid="instagram-post"] img');
  if (await card.getByTestId('instagram-post').count())
    await expectStoredImage(
      media,
      '/context/instagram/Generated_feed/image.png',
    );
  if (!expanded && (await card.getByTestId('instagram-post').count())) {
    const link = card
      .getByTestId('instagram-post')
      .getByRole('link', { name: 'Open on Instagram' });
    const linkBox = await link.boundingBox(),
      contentBox = await card.locator('[data-card-content]').boundingBox();
    expect
      .soft(linkBox!.y + linkBox!.height)
      .toBeLessThanOrEqual(contentBox!.y + contentBox!.height + 1);
  }
  const result = await card.evaluate((card) => {
    const root = document.scrollingElement!;
    const box = (node: Element) => {
      const { top, bottom, left, right } = node.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    return {
      pageHeight: root.scrollHeight,
      viewportHeight: root.clientHeight,
      card: box(card),
      actions: ['keep', 'later', 'mark'].map((name) =>
        box(card.querySelector(`[data-${name}-action]`)!),
      ),
      width: innerWidth,
      height: innerHeight,
    };
  });
  expect.soft(result.pageHeight).toBeLessThanOrEqual(result.viewportHeight);
  for (const box of [result.card, ...result.actions]) {
    expect.soft(box.top).toBeGreaterThanOrEqual(0);
    expect.soft(box.bottom).toBeLessThanOrEqual(result.height);
    expect.soft(box.left).toBeGreaterThanOrEqual(0);
    expect.soft(box.right).toBeLessThanOrEqual(result.width);
  }
  const primary = card.locator('[data-primary-text]');
  await expect(primary).toBeVisible();
  const primaryBox = await primary.boundingBox();
  expect.soft(primaryBox!.height).toBeGreaterThan(12);
  const reason = card
    .getByText('The generated post discusses council policy.', { exact: false })
    .first();
  await expect(reason).toBeVisible();
  if (!expanded) {
    const reasonBox = await reason.boundingBox();
    const contentBox = await card.locator('[data-card-content]').boundingBox();
    expect
      .soft(reasonBox!.y + reasonBox!.height)
      .toBeLessThanOrEqual(contentBox!.y + contentBox!.height + 1);
    expect
      .soft(primaryBox!.y + Math.min(primaryBox!.height, 28))
      .toBeLessThanOrEqual(contentBox!.y + contentBox!.height);
  }
  return card;
}

for (const size of sizes)
  test(`FIT-1 single viewport ${size.width}x${size.height}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
    for (const shape of shapes) {
      await prepare(page, shape);
      if (shape === 'reply') {
        await page
          .getByRole('tab', { name: /^Suggested for deletion,/ })
          .click();
        await page.getByRole('tab', { name: /^All,/ }).click();
        await expect(
          page
            .getByTestId('stored-original')
            .getByRole('link', { name: 'View original on X' }),
        ).toBeVisible();
      }
      await mode(page, true);
      await expect(page.getByRole('feed').locator('article')).toHaveCount(1);
      await geometry(page);
      if (shape === 'image') {
        const original = page.getByTestId('stored-original');
        const image = original.locator('img');
        await expectStoredImage(image, '/originals/81001/1.png');
        expect((await image.boundingBox())!.height).toBeLessThanOrEqual(
          size.height * 0.28 + 1,
        );
        await geometry(page);
      }
    }
  });

test('FIT-1 long text expands inside the card without moving its actions', async ({
  page,
}) => {
  await page.setViewportSize(sizes[0]!);
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  await prepare(page, 'long');
  await mode(page, true);
  const card = await geometry(page);
  await card
    .getByRole('button', { name: 'Show full text', exact: true })
    .click();
  await geometry(page, true);
  expect(
    await card
      .locator('[data-card-content]')
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await expect(card.locator('mark').first()).toHaveText('generated');
  await page.getByRole('tab', { name: /^Held back by your rules,/ }).click();
  await expect(
    page.getByRole('feed').getByText(/Held back: .*your rule/),
  ).toBeVisible();
});

test('R1 ADR suggestion and held line stay visible without opening details', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  await prepare(page, 'short');
  const card = page.getByRole('feed').locator('article').first();
  await expect(
    card.locator('strong').filter({ hasText: 'Suggestion: delete' }),
  ).toBeVisible();
  await expect(
    card.locator('p').filter({
      hasText:
        /Suggestion: delete · Political · Medium · Agent: Synthetic reader/,
    }),
  ).toBeVisible();
  await expect(card.locator('mark').first()).toHaveText('generated');
});

for (const size of [sizes[1]!, sizes[3]!])
  test(`R2 no orphan text control ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
    await prepare(page, 'tall');
    await mode(page, true);
    await geometry(page);
    await expect(
      page.getByRole('button', { name: /Show full|Show complete/ }),
    ).toHaveCount(0);
  });

test('R3 phone Instagram keeps a readable uncropped image and reachable actions', async ({
  page,
}) => {
  await page.setViewportSize(sizes[4]!);
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  for (const shape of ['tall', 'wide'] as const) {
    await prepare(page, shape);
    await mode(page, true);
    const card = await geometry(page);
    const image = card.getByTestId('instagram-post').locator('img').first();
    await expect(
      card
        .getByTestId('instagram-post')
        .getByRole('link', { name: 'Open on Instagram' }),
    ).toBeVisible();
    const rendered = await image.evaluate((node) => {
      const image = node as HTMLImageElement,
        box = image.getBoundingClientRect();
      const scale = Math.min(
        box.width / image.naturalWidth,
        box.height / image.naturalHeight,
      );
      return {
        paintedHeight: image.naturalHeight * scale,
        scale,
        fit: getComputedStyle(image).objectFit,
      };
    });
    expect(rendered.paintedHeight).toBeGreaterThanOrEqual(
      shape === 'tall' ? 160 : 110,
    );
    expect(rendered.scale).toBeLessThanOrEqual(1);
    expect(rendered.fit).toBe('contain');
  }
});

test('R2 clipped caption control belongs below that caption and expands internally', async ({
  page,
}) => {
  await page.setViewportSize(sizes[1]!);
  await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
  await prepare(page, 'tall');
  await mode(page, true);
  // Use the real generated fixture's caption to prove scoped expansion at phone size.
  await page.setViewportSize(sizes[4]!);
  const caption = page.locator('[data-caption-text]').first();
  const control = caption.getByRole('button', {
    name: 'Show full caption',
    exact: true,
  });
  await expect(control).toBeVisible();
  const textBox = await caption.locator('p').boundingBox(),
    buttonBox = await control.boundingBox();
  expect(buttonBox!.y).toBeGreaterThanOrEqual(textBox!.y + textBox!.height - 1);
  await control.click();
  await expect(
    caption.getByRole('button', { name: 'Show less text', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await geometry(page, true);
});

for (const size of [sizes[3]!, sizes[1]!, sizes[4]!])
  for (const theme of ['light', 'dark'] as const)
    for (const shape of ['280', 'tall'] as const)
      test(`FIT-1 captures ${shape} ${theme} ${size.width}`, async ({
        page,
      }) => {
        // eslint-disable-next-line no-restricted-properties -- Explicit generated screenshot destination, never credentials.
        const folder = process.env['SP_H_SCREEN_DIR'];
        test.skip(
          !folder || test.info().project.name !== 'chromium',
          'Screenshots target the maintainer Chromium viewport.',
        );
        await page.setViewportSize(size);
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await page.addInitScript((theme) => {
          localStorage.setItem('sp-locale', 'en');
          localStorage.setItem('sp-theme', theme);
        }, theme);
        await prepare(page, shape);
        for (const single of [true, false]) {
          await mode(page, single);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: join(
              folder!,
              `${shape === '280' ? 'x' : 'instagram'}-${single ? 'single' : 'list'}-${theme}-${size.width}x${size.height}.png`,
            ),
            animations: 'disabled',
          });
        }
      });

for (const size of [sizes[3]!, sizes[1]!, sizes[4]!])
  for (const theme of ['light', 'dark'] as const)
    test(`FIT-1 restored original capture ${theme} ${size.width}`, async ({
      page,
    }) => {
      // eslint-disable-next-line no-restricted-properties -- Explicit generated screenshot destination.
      const folder = process.env['SP_H_SCREEN_DIR'];
      test.skip(
        !folder || test.info().project.name !== 'chromium',
        'Explicit Chromium capture only.',
      );
      await page.setViewportSize(size);
      await page.addInitScript((theme) => {
        localStorage.setItem('sp-locale', 'en');
        localStorage.setItem('sp-theme', theme);
      }, theme);
      await prepare(page, 'image');
      for (const single of [true, false]) {
        await mode(page, single);
        await page.screenshot({
          path: join(
            folder!,
            `x-original-${single ? 'single' : 'list'}-${theme}-${size.width}x${size.height}.png`,
          ),
          animations: 'disabled',
        });
      }
    });
