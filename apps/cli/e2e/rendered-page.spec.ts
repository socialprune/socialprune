import { expect, test } from '@playwright/test';
import { xSelectors } from '../src/browser/x/selectors.ts';
import { compareFocal } from '../src/browser/x/fill/compare.ts';
import { migrateOriginal } from '@socialprune/core';
import { startConfirmation } from '../src/browser/confirmation.ts';
import { extract } from '../src/browser/x/fill/extract.ts';
import {
  cardComparisonAnswer,
  cardComparisonMarkup,
  CARD_COMPARISON_FIXTURE,
  ownPhotoAnswer,
  ownPhotoMarkup,
  OWN_PHOTO_FIXTURE,
} from './fake-x/fill-detail.ts';
test('delayed side nav waits for script rendering before account read; an empty page stops at the bounded render deadline', async ({
  page,
}) => {
  await page.setContent(
    '<main id="root"></main><script>setTimeout(()=>document.getElementById("root").innerHTML=\'<button data-testid="SideNav_AccountSwitcher_Button">@generated_account</button>\',100)</script>',
  );
  expect(await xSelectors.account(page)).toBe('generated_account');
  await page.setContent('<main></main>');
  await expect(xSelectors.account(page, 100)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
  });
});
test('focal article identity excludes every other timestamped post from state and menu selection', async ({
  page,
}) => {
  await page.setContent(
    '<article data-testid="tweet"><a href="/generated/status/900"><time>2026</time></a><button data-testid="caret">Other</button></article><article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><button data-testid="caret">Focal</button><button data-testid="unretweet">Focal repost</button></article>',
  );
  expect(await xSelectors.state(page, '910')).toBe('present');
  expect(await (await xSelectors.more(page, '910')).innerText()).toBe('Focal');
  expect(await (await xSelectors.repost(page, '910')).innerText()).toBe(
    'Focal repost',
  );
});
test('automatic comparison normalizes whitespace and known t.co link rendering, counts focal media only and rejects missing tail', async ({
  page,
}) => {
  const base = migrateOriginal({
    id: '910',
    status: 'fetched',
    fetchedAt: '2026-10-13T12:00:00.000Z',
    text: 'Generated\nvisit https://t.co/generatedLink',
    authorName: null,
    authorHandle: null,
    photos: [],
    quotedId: null,
    parentId: null,
    raw: null,
    textCompleteness: 'unknown',
    video: null,
  });
  base.textCompleteness = 'full';
  base.media = [
    {
      n: 1,
      kind: 'photo',
      source: 'anonymous',
      url: null,
      file: null,
      poster: null,
      status: 'failed',
      bytes: null,
      durationMs: null,
      bitrateLabel: null,
      altText: null,
    },
    {
      n: 2,
      kind: 'video',
      source: 'anonymous',
      url: null,
      file: null,
      poster: null,
      status: 'not-stored',
      bytes: null,
      durationMs: null,
      bitrateLabel: null,
      altText: null,
    },
  ];
  await page.setContent(
    '<article data-testid="tweet"><a href="/generated/status/999"><time>2026</time></a><p data-testid="tweetText">Generated unrelated article</p><div data-testid="tweetPhoto"></div></article><article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><p data-testid="tweetText">Generated visit <a href="https://t.co/generatedLink">example.org/generated</a></p><div data-testid="tweetPhoto"></div><div data-testid="videoPlayer"><video></video></div></article>',
  );
  expect((await compareFocal(page, base)).matches).toBe(true);
  expect(
    (
      await compareFocal(page, {
        ...base,
        text: base.text + ' missing generated tail',
      })
    ).matches,
  ).toBe(false);
});

for (const kind of [
  'quote',
  'link',
  'video',
  'rendered-link',
  'missing-rendered-link',
] as const)
  test(`focal-own ${kind} comparison excludes nested quote cards and removes only unrendered card links`, async ({
    page,
  }) => {
    await page.route('**/*', (route) => route.abort());
    await page.setContent(cardComparisonMarkup('910', kind));
    const result = extract(cardComparisonAnswer('910', kind), '910', {
      instruction: null,
    });
    if (result.kind !== 'read')
      throw new Error('Generated focal post was not read.');
    const original = { ...result.post, anonymous: null, signedIn: null };
    const comparison = await compareFocal(
      page,
      original,
      result.displayText,
      result.displayLinks,
    );
    expect(comparison.matches).toBe(kind !== 'missing-rendered-link');
    expect(comparison.stored.photos).toBe(0);
    expect(comparison.shown.photos).toBe(0);
    expect(comparison.shown.videos).toBe(kind === 'video' ? 1 : 0);
    if (kind === 'video') expect(comparison.stored.textLength).toBe(0);
    if (kind === 'link')
      expect(comparison.shown.textLength).toBe(
        CARD_COMPARISON_FIXTURE.linkText.length,
      );
  });

test('zero own text matches only an empty display after permitted removals, and multiple own text nodes always mismatch', async ({
  page,
}) => {
  await page.route('**/*', (route) => route.abort());
  const result = extract(cardComparisonAnswer('910', 'video'), '910', {
    instruction: null,
  });
  if (result.kind !== 'read')
    throw new Error('Generated focal video was not read.');
  const original = { ...result.post, anonymous: null, signedIn: null };
  await page.setContent(cardComparisonMarkup('910', 'video'));
  expect((await compareFocal(page, original, '')).matches).toBe(true);
  expect(
    (
      await compareFocal(page, original, CARD_COMPARISON_FIXTURE.quoteUrl, [
        CARD_COMPARISON_FIXTURE.quoteUrl,
      ])
    ).matches,
  ).toBe(true);
  expect(
    (
      await compareFocal(page, original, 'https://t.co/generatedUnrelated', [
        CARD_COMPARISON_FIXTURE.quoteUrl,
      ])
    ).matches,
  ).toBe(false);
  expect(
    (await compareFocal(page, original, 'Generated missing focal text'))
      .matches,
  ).toBe(false);
  await page.setContent(
    '<article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><p data-testid="tweetText"></p><p data-testid="tweetText"></p><div data-testid="videoPlayer"><video></video></div></article>',
  );
  expect((await compareFocal(page, original, '')).matches).toBe(false);
});

test('quoted video players and photos never contribute to the focal own media counts', async ({
  page,
}) => {
  await page.route('**/*', (route) => route.abort());
  const result = extract(cardComparisonAnswer('910', 'quote'), '910', {
    instruction: null,
  });
  if (result.kind !== 'read')
    throw new Error('Generated focal quote was not read.');
  const original = { ...result.post, anonymous: null, signedIn: null };
  await page.setContent(
    `<article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><p data-testid="tweetText">${CARD_COMPARISON_FIXTURE.ownText}</p><div role="link"><p data-testid="tweetText">Generated quoted video</p><div data-testid="tweetPhoto"><img alt="Generated quoted photo"></div><div data-testid="tweetPhoto"><div data-testid="videoPlayer"><video></video></div></div><video></video></div></article>`,
  );
  const value = await compareFocal(
    page,
    original,
    result.displayText,
    result.displayLinks,
  );
  expect(value).toMatchObject({
    matches: true,
    stored: { photos: 0, videos: 0 },
    shown: { photos: 0, videos: 0 },
  });
});

test('only role-link cards nested inside the focal article are excluded, not an outer role-link ancestor', async ({
  page,
}) => {
  await page.route('**/*', (route) => route.abort());
  const result = extract(cardComparisonAnswer('910', 'quote'), '910', {
    instruction: null,
  });
  if (result.kind !== 'read')
    throw new Error('Generated focal quote was not read.');
  await page.setContent(
    `<section role="link">${cardComparisonMarkup('910', 'quote')}</section>`,
  );
  expect(
    (
      await compareFocal(
        page,
        { ...result.post, anonymous: null, signedIn: null },
        result.displayText,
        result.displayLinks,
      )
    ).matches,
  ).toBe(true);
});

test('two focal own photos inside role-link anchors are counted while quoted photos inside a role-link div stay excluded', async ({
  page,
}) => {
  await page.route('**/*', (route) => route.abort());
  const result = extract(ownPhotoAnswer('910'), '910', { instruction: null });
  if (result.kind !== 'read')
    throw new Error('Generated focal photo post was not read.');
  const original = { ...result.post, anonymous: null, signedIn: null };
  await page.setContent(ownPhotoMarkup('910'));
  const article = page.locator('article[data-testid="tweet"]');
  expect(await article.locator('div[role="link"]').count()).toBe(0);
  expect(
    await article.locator('a[role="link"][href$="/photo/1"]').count(),
  ).toBe(1);
  expect(
    await article.locator('a[role="link"][href$="/photo/2"]').count(),
  ).toBe(1);
  expect(
    await compareFocal(page, original, result.displayText, result.displayLinks),
  ).toMatchObject({
    matches: true,
    stored: { photos: OWN_PHOTO_FIXTURE.photos },
    shown: { photos: OWN_PHOTO_FIXTURE.photos },
  });
  const quote = cardComparisonMarkup('910', 'quote');
  await page.setContent(
    ownPhotoMarkup('910').replace(
      '</article>',
      quote.slice(
        quote.indexOf('<div role="link">'),
        quote.lastIndexOf('</article>'),
      ) + '</article>',
    ),
  );
  expect(await article.locator('div[role="link"]').count()).toBe(1);
  expect(await article.getByTestId('tweetPhoto').count()).toBe(4);
  expect(
    await compareFocal(page, original, result.displayText, result.displayLinks),
  ).toMatchObject({
    matches: true,
    shown: { photos: OWN_PHOTO_FIXTURE.photos },
  });
});
test('an older in-flight confirmation poll cannot overwrite the ended state', async ({
  page,
}) => {
  const initial = {
    phase: 'start' as const,
    warning: 'Generated',
    profileWarning: 'Generated',
    planned: 0,
    bulk: 0,
    estimateMs: 0,
    list: 'generated',
    rows: [],
    completed: 0,
    result: 'Generated initial',
  };
  const server = await startConfirmation(initial, 4232);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let delivered!: () => void;
  const staleDelivered = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let calls = 0;
  await page.route('**/api/view', async (route) => {
    calls++;
    if (calls === 2) {
      const reply = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response: reply });
      delivered();
    } else await route.continue();
  });
  // Delay/reorder only test responses, not a production fault flag or fake script.
  await page.route('**/api/action', async (route) => {
    server.update({ phase: 'ended', result: 'Ended: Generated final.' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...initial,
        phase: 'ended',
        version: 2,
        result: 'Ended: Generated final.',
      }),
    });
  });
  try {
    await page.goto(server.launchUrl);
    await expect(page.locator('#start')).toBeVisible();
    await ready;
    await page.locator('#start').click();
    await expect(page.locator('#result')).toHaveText('Ended: Generated final.');
    release();
    await staleDelivered;
    await expect.poll(() => calls).toBeGreaterThan(2);
    await expect(page.locator('#result')).toHaveText('Ended: Generated final.');
    await expect(page.locator('#start')).toBeHidden();
  } finally {
    release();
    await server.close();
  }
});
