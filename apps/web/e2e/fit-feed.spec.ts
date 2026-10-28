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

async function prepare(page: Page, shape: Shape, longCopy = false) {
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
  if (longCopy)
    item.text =
      'Ein erfundener ausführlicher Kommentar über den Garten und den Gemeinderat. '.repeat(
        60,
      );
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
    instagram
      ? [
          {
            ...generatedReadPost(),
            post: {
              ...generatedReadPost().post,
              caption: longCopy
                ? 'Ein erfundener ausführlicher Bildtext über den Garten und den Gemeinderat. '.repeat(
                    60,
                  )
                : generatedReadPost().post.caption,
            },
          },
        ]
      : [],
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
    await page
      .getByRole('tab', { name: /^(Suggested for deletion|Löschvorschläge),/ })
      .click();
    await page.getByRole('tab', { name: /^(All|Alle),/ }).click();
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
        name: single ? /^(One at a time|Einzeln)$/ : /^(List|Liste)$/,
        exact: true,
      })
      .click();
  } else {
    await page
      .getByRole('button', { name: /^(Review options|Ansichtsoptionen)$/ })
      .click();
    await page
      .getByRole('menuitem', {
        name: single ? /^(One at a time|Einzeln)$/ : /^(All|Alle)$/,
        exact: true,
      })
      .click();
  }
}

async function compound(page: Page, instagram: boolean) {
  await page.goto('about:blank');
  const data = headerFixture();
  const item = data.items.find(
    (item) => item.id === (instagram ? 'instagram:feed-read' : 'x:feed-1'),
  )!;
  item.text =
    '@generated_one @generated_two @generated_three ' +
    'An invented discussion asks the council to improve the garden paths and keep the public meeting open. '.repeat(
      3,
    );
  item.engagement.likes = 14;
  item.kind = instagram ? 'comment' : 'reply';
  if (!instagram) {
    item.reference.replyToId = '81001';
    item.reference.replyToHandle = 'generated_author';
  }
  data.settings.review!.accountKey = item.account.key;
  data.settings.review!.feed!.tab = 'held';
  const assessment = data.assessments.find((a) => a.itemId === item.id)!;
  assessment.risk = 1;
  assessment.reason =
    'The invented council discussion contains a political suggestion.';
  assessment.evidence = 'council';
  data.assessments.push({
    ...assessment,
    assessmentId: 'generated-second-assessment',
    submissionId: 'generated-second-submission',
    source: { ...assessment.source, name: 'Second generated reader' },
    reason: 'The invented public meeting is another generated reason.',
    evidence: 'public meeting',
  });
  data.submissions.push({
    ...data.submissions[0]!,
    submissionId: 'generated-second-submission',
    source: { kind: 'agent', version: '1', name: 'Second generated reader' },
    contentHash: `sha256:${'c'.repeat(64)}`,
    labelCount: 1,
  });
  data.counts.assessments++;
  data.counts.submissions++;
  await restoreLiveFeed(
    page,
    data,
    undefined,
    instagram ? [generatedReadPost()] : [],
  );
  const original = generatedOriginal({
    text: 'A generated original discusses the garden paths and the public meeting.',
    media: [],
  });
  await page.evaluate((original) => {
    window.workspace.getOriginals = () => Promise.resolve([original]);
    const request = window.workspace.request.bind(window.workspace);
    window.workspace.request = (input, transfer) =>
      input.type === 'getConversation'
        ? Promise.resolve({
            type: 'conversation',
            requestId: input.requestId,
            chain: [{ id: original.id, original, ownItemId: null }],
            state: 'complete',
          })
        : request(input, transfer);
  }, original);
  await page.getByRole('tab', { name: /^(All|Alle),/ }).click();
  await page
    .getByRole('tab', { name: /^(Held back|Von deinen Regeln)/ })
    .click();
  await mode(page, true);
  return item.id;
}

async function noIntersections(card: Locator) {
  return card.evaluate((card) => {
    const selectors =
      '[data-primary-text], [data-clamped-text] > button, [data-testid="stored-original"], [data-testid="instagram-post"], [class*="metadataLine"], [class*="suggestionLine"] p, [class*="suggestionReason"], [class*="held"] p, [class*="suggestionDetails"] > summary, [data-keep-action], [data-later-action], [data-mark-action], [data-reset-action]';
    const nodes = [...card.querySelectorAll<HTMLElement>(selectors)].filter(
      (node) => node.getClientRects().length,
    );
    const pairs: string[] = [];
    const visibleBox = (node: HTMLElement) => {
      const r = node.getBoundingClientRect();
      const box = {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
      for (
        let parent = node.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent),
          clip = parent.getBoundingClientRect();
        if (/hidden|auto|scroll|clip/.test(style.overflowY)) {
          box.top = Math.max(box.top, clip.top);
          box.bottom = Math.min(box.bottom, clip.bottom);
        }
        if (/hidden|auto|scroll|clip/.test(style.overflowX)) {
          box.left = Math.max(box.left, clip.left);
          box.right = Math.min(box.right, clip.right);
        }
      }
      return box;
    };
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!,
          b = nodes[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const x = visibleBox(a),
          y = visibleBox(b);
        if (
          Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
          Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1
        )
          pairs.push(
            `${a.tagName}.${a.className} ${a.textContent?.slice(0, 30)} ${JSON.stringify(x)} parent ${JSON.stringify({ height: a.parentElement?.getBoundingClientRect().height, display: getComputedStyle(a.parentElement!).display, post: a.closest('[class*="postBody"]')?.getBoundingClientRect().height })} intersects ${b.tagName}.${b.className} ${b.textContent?.slice(0, 30)} ${JSON.stringify(y)}`,
          );
      }
    return pairs;
  });
}

for (const lang of ['de', 'en'])
  for (const theme of ['dark', 'light'])
    for (const platform of ['x', 'instagram'])
      test(`compound no overlap ${platform} ${lang} ${theme}`, async ({
        page,
      }, info) => {
        test.setTimeout(120_000);
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        await page.setViewportSize({ width: 784, height: 782 });
        const id = await compound(page, platform === 'instagram');
        const card = page
          .getByRole('feed')
          .locator(`article[data-card-id="${id}"]`);
        await expect(card).toBeVisible();
        await expect(card.locator('[class*="suggestionLine"]')).toHaveCount(2);
        await expect(card.locator('[class*="held"] p')).toHaveCount(1);
        if (platform === 'x')
          await expect(card.getByTestId('stored-original')).toBeVisible();
        else
          await expect(
            card.getByTestId('instagram-post').locator('img').first(),
          ).toBeVisible();
        // eslint-disable-next-line no-restricted-properties -- Caller-owned generated screenshots only.
        const folder = process.env['SP_H_SCREEN_DIR'];
        const widths = [
          784, 541, 600, 700, 900, 1024, 1100, 1279, 1280, 1920, 320, 390,
        ];
        for (const width of widths)
          for (const height of [782, 700, 900]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                  ),
                ),
            );
            if (folder && info.project.name === 'chromium' && height === 782)
              await page.screenshot({
                path: join(
                  folder,
                  `compound-${platform}-${lang}-${theme}-${width}.png`,
                ),
              });
            expect
              .soft(await noIntersections(card), `${width}x${height}`)
              .toEqual([]);
            const firstSuggestion = await card.evaluate((card) => {
              const content = card.querySelector('[data-card-content]')!;
              const first = card.querySelector(
                '[data-first-suggestion] [class*="suggestionLine"]',
              )!;
              const reason = first.parentElement!.querySelector(
                '[class*="suggestionReason"]',
              )!;
              const bounds = content.getBoundingClientRect();
              return {
                scroll: content.scrollTop,
                top: bounds.top,
                bottom: bounds.bottom,
                lineTop: first.getBoundingClientRect().top,
                lineBottom: first.getBoundingClientRect().bottom,
                reasonTop: reason.getBoundingClientRect().top,
                reasonBottom: reason.getBoundingClientRect().bottom,
              };
            });
            expect
              .soft(firstSuggestion.scroll, `initial scroll ${width}x${height}`)
              .toBe(0);
            expect
              .soft(
                firstSuggestion.lineTop,
                `suggestion top ${width}x${height}`,
              )
              .toBeGreaterThanOrEqual(firstSuggestion.top);
            expect
              .soft(
                firstSuggestion.lineBottom,
                `suggestion bottom ${width}x${height}`,
              )
              .toBeLessThanOrEqual(firstSuggestion.bottom + 1);
            expect
              .soft(
                firstSuggestion.reasonBottom,
                `reason bottom ${width}x${height}`,
              )
              .toBeLessThanOrEqual(firstSuggestion.bottom + 1);
            if (platform === 'x') {
              const provenance = await card
                .getByTestId('stored-original')
                .evaluate((original) => {
                  const text = original.querySelector('[data-clamped-text]')!;
                  const meta = original.querySelector('[class*="meta"]')!;
                  const link = original.querySelector('a')!;
                  return {
                    textBottom: text.getBoundingClientRect().bottom,
                    metaTop: meta.getBoundingClientRect().top,
                    linkText: link.textContent,
                    preceding: link.previousSibling?.textContent?.trim(),
                  };
                });
              expect
                .soft(
                  provenance.metaTop,
                  `provenance below text ${width}x${height}`,
                )
                .toBeGreaterThanOrEqual(provenance.textBottom - 1);
              expect
                .soft(
                  provenance.linkText?.trim().startsWith('·'),
                  `no leading separator ${width}x${height}`,
                )
                .toBe(false);
            }
            await card.locator('[data-card-reading]').evaluate((node) => {
              node.scrollTop = node.scrollHeight;
            });
            expect
              .soft(await noIntersections(card), `scrolled ${width}x${height}`)
              .toEqual([]);
            await card.locator('[data-card-reading]').evaluate((node) => {
              node.scrollTop = 0;
            });
            const actions = await card
              .locator('[data-mark-action]')
              .boundingBox();
            expect
              .soft(actions!.y + actions!.height, `actions ${width}x${height}`)
              .toBeLessThanOrEqual(height);
          }
        if (
          folder &&
          info.project.name === 'chromium' &&
          ((lang === 'de' && theme === 'dark') ||
            (lang === 'en' && theme === 'light'))
        )
          for (const [width, height] of [
            [784, 782],
            [1024, 768],
            [1366, 768],
            [390, 844],
          ]) {
            await page.setViewportSize({ width: width!, height: height! });
            await expect
              .poll(async () => {
                const bounds = await card
                  .locator('[data-card-content]')
                  .boundingBox();
                const reason = await card
                  .locator('[data-first-suggestion]')
                  .boundingBox();
                return reason
                  ? reason.y + reason.height <= bounds!.y + bounds!.height + 1
                  : false;
              })
              .toBe(true);
            await page.screenshot({
              path: join(
                folder,
                `view-${platform}-${lang}-${theme}-${width}x${height}.png`,
              ),
            });
          }
      });

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

for (const lang of ['en', 'de'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390])
      for (const platform of ['x', 'instagram'] as const)
        test(`R3 phone media with long copy ${platform} ${lang} ${theme} ${width}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 844 });
          await page.addInitScript(
            ({ lang, theme }) => {
              localStorage.setItem('sp-locale', lang);
              localStorage.setItem('sp-theme', theme);
            },
            { lang, theme },
          );
          await prepare(page, platform === 'instagram' ? 'tall' : 'long', true);
          await page.evaluate(() =>
            document.documentElement.style.setProperty(
              '--font-family',
              'Verdana, sans-serif',
            ),
          );
          await mode(page, true);
          const card = page.getByRole('feed').locator('article').first();
          const content = await card
            .locator('[data-card-content]')
            .boundingBox();
          const suggestion = card
            .locator('p')
            .filter({ hasText: /^(Suggestion: delete|Vorschlag: löschen)/ })
            .first();
          const reason = card
            .getByText('The generated post discusses council policy.', {
              exact: true,
            })
            .first();
          for (const line of [suggestion, reason]) {
            await expect(line).toBeVisible();
            const box = await line.boundingBox();
            expect(box!.y).toBeGreaterThanOrEqual(content!.y);
            expect(box!.y + box!.height).toBeLessThanOrEqual(
              content!.y + content!.height + 1,
            );
          }
          expect(
            await card
              .locator('[data-card-content]')
              .evaluate((node) => node.scrollTop),
          ).toBe(0);
          for (const action of ['keep', 'later', 'mark']) {
            const box = await card
              .locator(`[data-${action}-action]`)
              .boundingBox();
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.y + box!.height).toBeLessThanOrEqual(844);
          }
          if (platform === 'instagram') {
            await expectStoredImage(
              card.getByTestId('instagram-post').locator('img'),
              '/context/instagram/Generated_feed/image.png',
            );
            const image = card.getByTestId('instagram-post').locator('img');
            const before = await image.boundingBox();
            expect(before!.height).toBeGreaterThanOrEqual(160);
            expect(
              await image.evaluate((node) => getComputedStyle(node).objectFit),
            ).toBe('contain');
            for (const action of ['keep', 'later', 'mark']) {
              const box = await card
                .locator(`[data-${action}-action]`)
                .boundingBox();
              expect(box!.y).toBeGreaterThanOrEqual(0);
              expect(box!.y + box!.height).toBeLessThanOrEqual(844);
            }
            expect(before!.y).toBeGreaterThanOrEqual(content!.y);
            expect(before!.y + before!.height).toBeLessThanOrEqual(
              content!.y + content!.height + 1,
            );
            const caption = card.locator('[data-caption-text]');
            const expand = caption.getByRole('button');
            await expect(expand).toBeVisible();
            await expand.click();
            await expect(expand).toHaveAttribute('aria-expanded', 'true');
            expect((await image.boundingBox())!.height).toBe(before!.height);
            await expand.click();
          }
          // eslint-disable-next-line no-restricted-properties -- Explicit screenshot destination, never credentials.
          const folder = process.env['SP_H_SCREEN_DIR'];
          if (folder && test.info().project.name === 'chromium')
            await page.screenshot({
              path: join(
                folder,
                `${platform}-single-${lang}-${theme}-${width}.png`,
              ),
              animations: 'disabled',
            });
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

for (const locale of ['en', 'de'] as const)
  test(`original provenance and platform link are separated in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize(sizes[1]!);
    await page.addInitScript(
      (locale) => localStorage.setItem('sp-locale', locale),
      locale,
    );
    await prepare(page, 'image');
    const original = page.getByTestId('stored-original');
    const link = original.getByRole('link', {
      name: locale === 'en' ? 'View original on X' : 'Original auf X ansehen',
      exact: true,
    });
    for (const single of [true, false]) {
      await page
        .getByRole('button', {
          name:
            locale === 'en'
              ? single
                ? 'One at a time'
                : 'List'
              : single
                ? 'Einzeln'
                : 'Liste',
          exact: true,
        })
        .click();
      await expect(link).toBeVisible();
      const adjacency = await link.evaluate((link) => {
        const text = link.parentElement!.textContent;
        const index = text.indexOf(link.textContent);
        const previous = link.previousSibling;
        const prior =
          previous instanceof Element ? previous.getBoundingClientRect() : null;
        const box = link.getBoundingClientRect();
        return {
          before: text.slice(0, index),
          startsNewLine: !!prior && box.top >= prior.bottom - 1,
        };
      });
      expect(adjacency.startsNewLine || /[\s·|]$/u.test(adjacency.before)).toBe(
        true,
      );
    }
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
        if (!single)
          await page
            .getByTestId('stored-original')
            .getByRole('link', { name: 'View original on X', exact: true })
            .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(
            folder!,
            `x-original-${single ? 'single' : 'list'}-${theme}-${size.width}x${size.height}.png`,
          ),
          animations: 'disabled',
        });
      }
    });
