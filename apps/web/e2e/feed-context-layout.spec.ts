import { expect, test } from '@playwright/test';
import {
  liveExpected,
  liveFeedFixture,
  restoreLiveFeed,
} from './feed-fixture.ts';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';

test('confirmed Instagram context and long user text reflow at 320 px with wider font metrics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('sp-locale', 'de');
  });
  const data = liveFeedFixture();
  const item = data.items.find((item) => item.platform === 'instagram')!;
  item.text = `Generated_${'unbroken_comment_'.repeat(30)}`;
  const record = instagramContractRecord(item);
  record.post.caption = `Generated_${'unbroken_caption_'.repeat(30)}`;
  record.image = { file: null, host: null, status: 'not-captured' };
  record.screenshot = { file: null, bytes: null, status: 'failed' };
  await restoreLiveFeed(page, data);
  await page.evaluate((record) => {
    window.workspace.getInstagramContext = () => Promise.resolve([record]);
  }, record);
  await page
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption(liveExpected.instagram);
  const post = page.getByTestId('instagram-post');
  await expect(post).toContainText(record.post.caption);
  await expect(post).toContainText(
    'SocialPrune hat das erste Bild dieses Beitrags nicht behalten.',
  );
  // Deliberate font-metric stress, not a claim to emulate Ubuntu's exact font.
  await page.evaluate(() => {
    const sheet = document.styleSheets[0]!;
    sheet.insertRule(
      'html body * { font-family: "Courier New", monospace !important; }',
      sheet.cssRules.length,
    );
    sheet.insertRule(
      'html body header nav a { font-size: 14px !important; }',
      sheet.cssRules.length,
    );
  });
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    header: [
      ...document.querySelectorAll(
        'header, header > *, header a, header button',
      ),
    ].map((element) => ({
      tag: element.tagName,
      text: element.textContent?.slice(0, 30),
      right: element.getBoundingClientRect().right,
      font: getComputedStyle(element).fontFamily,
    })),
    overflow: [
      ...document.querySelectorAll<HTMLElement>('[data-testid="feed-card"] *'),
    ]
      .filter(
        (element) => element.getBoundingClientRect().right > innerWidth + 1,
      )
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: element.textContent?.slice(0, 90),
        right: element.getBoundingClientRect().right,
      })),
  }));
  console.log('CONFIRMED_CONTEXT_GEOMETRY', JSON.stringify(geometry));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.overflow).toEqual([]);
  for (const control of await page
    .locator('header')
    .first()
    .locator('a, button')
    .all()) {
    if (!(await control.isVisible())) continue;
    const bounds = await control.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
});
