import { expect, test } from '@playwright/test';
import { xSelectors } from '../src/browser/x/selectors.ts';
import {
  compareFocal,
  compareNotice,
  noticeAlignmentFromAnswer,
  compareEmptyFocal,
} from '../src/browser/x/fill/compare.ts';
import { migrateOriginal } from '@socialprune/core';
import { startConfirmation } from '../src/browser/confirmation.ts';
import { extract } from '../src/browser/x/fill/extract.ts';
import { TEST_PORTS } from '../playwright.ports.config.ts';
import {
  cardComparisonAnswer,
  cardComparisonMarkup,
  CARD_COMPARISON_FIXTURE,
  ownPhotoAnswer,
  ownPhotoMarkup,
  OWN_PHOTO_FIXTURE,
  gatedMediaAnswer,
  gatedMediaMarkup,
  GATED_MEDIA_FIXTURE,
  notePhotoAnswer,
  notePhotoMarkup,
  NOTE_RENDER_FIXTURE,
  gatedLatePlayerMarkup,
  protectedNoticeMarkup,
  protectedNoticeText,
  textContentMarkup,
  textContentAnswer,
  textContentStoredText,
  TEXT_CONTENT_FIXTURE,
  noticeAlignmentMarkup,
  noticeAlignmentAnswer,
  NOTICE_ALIGNMENT_FIXTURE,
  emptyFocalMarkup,
  selfThreadEmptyMarkup,
  SELF_THREAD_EMPTY_FIXTURE,
  inlineQuoteAnswer,
  inlineQuoteMarkup,
  INLINE_QUOTE_FIXTURE,
  statusEntityAnswer,
  statusEntityMarkup,
  STATUS_ENTITY_FIXTURE,
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
    reason: 'render-timeout',
  });
});

for (const [testId, reason] of [
  ['loginButton', 'marker-login'],
  ['challenge', 'marker-challenge'],
  ['lockedAccount', 'marker-locked'],
  ['rateLimit', 'marker-rate-limit'],
] as const)
  test(`platform marker ${testId} names its check without changing rejection of a hidden marker`, async ({
    page,
  }) => {
    await page.setContent(
      `<div data-testid="${testId}" style="display:none">Generated marker</div>`,
    );
    await expect(xSelectors.check(page)).rejects.toMatchObject({
      code: 'PLATFORM_CHECK',
      reason,
    });
  });

test('selector structural and text checks report only their closed reason tokens', async ({
  page,
}) => {
  await page.setContent('<p>Bei X anmelden</p>');
  await expect(xSelectors.check(page)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'notice-text',
  });
  await page.setContent(
    '<button data-testid="SideNav_AccountSwitcher_Button">Generated without handle</button>',
  );
  await expect(xSelectors.account(page)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'account-handle',
  });
  await page.setContent(
    '<button data-testid="SideNav_AccountSwitcher_Button">@generated_one @generated_two</button>',
  );
  await expect(xSelectors.account(page)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'account-handle',
  });
  await page.setContent(
    '<button data-testid="SideNav_AccountSwitcher_Button">@generated_one</button><button data-testid="SideNav_AccountSwitcher_Button">@generated_two</button>',
  );
  await expect(xSelectors.account(page)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'count',
  });
  await page.setContent(
    '<button data-testid="delete" style="display:none">Delete</button>',
  );
  await expect(xSelectors.deleteMenu(page)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'hidden',
  });
  await page.setContent('<main></main>');
  await expect(xSelectors.focal(page, '910')).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'focal-count',
  });
  await page.setContent(
    '<article data-testid="tweet" style="display:none"><a href="/generated/status/910"><time>2026</time></a></article>',
  );
  await expect(xSelectors.focal(page, '910')).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'hidden',
  });
  expect(() => xSelectors.focalLocator(page, 'generated-bad-id')).toThrow(
    expect.objectContaining({ code: 'PLATFORM_CHECK', reason: 'bad-id' }),
  );
  await page.setContent(
    '<article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><a href="/generated/status/910"><time>2026</time></a></article>',
  );
  await expect(xSelectors.state(page, '910')).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
    reason: 'focal-time',
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
for (const [label, exposed] of [
  ['overlay-only', ''],
  [
    'video-player',
    '<div data-testid="videoPlayer"><video preload="none"></video></div>',
  ],
  ['bare-video', '<video preload="none"></video>'],
  [
    'own-photo',
    '<a role="link" href="/generated/status/910/photo/1"><div data-testid="tweetPhoto"></div></a>',
  ],
] as const)
  test(`gated focal ${label} comparison expects zero own media without reading an overlay label`, async ({
    page,
  }) => {
    await page.route('**/*', (route) => route.abort());
    const result = extract(gatedMediaAnswer('910'), '910', {
      instruction: null,
    });
    if (result.kind !== 'read')
      throw new Error('Generated gated focal was not read.');
    const original = { ...result.post, anonymous: null, signedIn: null };
    // Earlier stored media does not become evidence of media shown through the gate.
    original.media[0] = {
      ...original.media[0]!,
      status: 'stored',
      file: '1.mp4',
      bytes: 12,
    };
    const markup = gatedMediaMarkup('910').replace(
      GATED_MEDIA_FIXTURE.overlay,
      'Generated unrelated-language label',
    );
    await page.setContent(markup.replace('</article>', exposed + '</article>'));
    const compared = await compareFocal(
      page,
      original,
      result.displayText,
      result.displayLinks,
      true,
    );
    expect(compared).toMatchObject({
      stored: {
        textLength: GATED_MEDIA_FIXTURE.text.length,
        photos: 0,
        videos: 0,
      },
      matches: label === 'overlay-only',
    });
    expect(compared.shown.photos).toBe(label === 'own-photo' ? 1 : 0);
    expect(compared.shown.videos).toBe(
      label === 'video-player' || label === 'bare-video' ? 1 : 0,
    );
    if (label === 'video-player' || label === 'bare-video')
      expect(
        (
          await compareFocal(
            page,
            original,
            result.displayText,
            result.displayLinks,
          )
        ).matches,
      ).toBe(true);
    expect(await page.getByRole('button').count()).toBe(1);
  });

for (const kind of ['delayed-photo', 'missing-photo', 'delayed-text'] as const)
  test(`focal render wait for generated note ${kind} never accepts missing media`, async ({
    page,
  }) => {
    await page.route('**/*', (route) => route.abort());
    const result = extract(notePhotoAnswer('910'), '910', {
      instruction: null,
    });
    if (result.kind !== 'read') throw new Error('Generated note was not read.');
    await page.setContent(notePhotoMarkup('910', kind));
    const compared = await compareFocal(
      page,
      { ...result.post, anonymous: null, signedIn: null },
      result.displayText,
      result.displayLinks,
    );
    expect(compared).toMatchObject({
      stored: {
        textLength: NOTE_RENDER_FIXTURE.text.length,
        photos: 1,
        videos: 0,
      },
      shown: {
        textLength: NOTE_RENDER_FIXTURE.text.length,
        photos: kind === 'missing-photo' ? 0 : 1,
        videos: 0,
      },
      matches: kind !== 'missing-photo',
    });
  });

test('focal render wait catches a gated player added 1.5 seconds after the shown text', async ({
  page,
}) => {
  const result = extract(gatedMediaAnswer('910'), '910', { instruction: null });
  if (result.kind !== 'read')
    throw new Error('Generated gated post was not read.');
  await page.setContent(gatedLatePlayerMarkup('910'));
  expect(
    await compareFocal(
      page,
      { ...result.post, anonymous: null, signedIn: null },
      result.displayText,
      result.displayLinks,
      true,
    ),
  ).toMatchObject({
    stored: { photos: 0, videos: 0 },
    shown: { photos: 0, videos: 1 },
    matches: false,
  });
});

for (const kind of [
  'match',
  'different',
  'duplicate',
  'missing',
  'missing-link',
  'long-tail',
  'long-match',
  'delayed',
  'error-detail',
] as const)
  test(`protected tombstone notice ${kind} matches the whole answer independently of language and parent posts`, async ({
    page,
  }) => {
    await page.setContent(protectedNoticeMarkup('de', kind));
    const result = await compareNotice(
      page,
      'tombstone',
      protectedNoticeText('de', kind === 'long-tail' || kind === 'long-match'),
    );
    expect(result).toMatchObject({
      stored: { textLength: 0, photos: 0, videos: 0 },
      shown: { textLength: 0, photos: 0, videos: 0 },
      matches: [
        'match',
        'delayed',
        'error-detail',
        'long-match',
        'duplicate',
      ].includes(kind),
    });
    expect(JSON.stringify(result)).not.toContain(protectedNoticeText('de'));
  });

for (const [status, en, de] of [
  ['not-found', "This Post doesn't exist.", 'Dieser Post existiert nicht.'],
  [
    'unavailable',
    'This Post is unavailable.',
    'Dieser Post ist nicht verfügbar.',
  ],
] as const)
  test(`${status} notice keeps its existing error-detail markers and does not admit an unlabelled article`, async ({
    page,
  }) => {
    for (const text of [en, de]) {
      await page.setContent(`<p data-testid="error-detail">${text}</p>`);
      expect((await compareNotice(page, status)).matches).toBe(true);
      await page.setContent(`<div role="article">${text}</div>`);
      expect((await compareNotice(page, status)).matches).toBe(false);
    }
  });

for (const kind of [
  'mention',
  'missing-word',
  'hidden-link',
  'missing-link',
] as const)
  test(`exact focal textContent ${kind} handles mention layout without admitting absent words or links`, async ({
    page,
  }) => {
    await page.route('**/*', (route) => route.abort());
    await page.setContent(textContentMarkup('910', kind));
    const text = page.getByTestId('tweetText');
    const normalize = (value: string | null) =>
      (value ?? '').replace(/\s+/gu, ' ').trim();
    const inner = normalize(await text.innerText());
    const content = normalize(await text.textContent());
    const fixture = TEXT_CONTENT_FIXTURE;
    const hasLink = kind === 'hidden-link' || kind === 'missing-link';
    const plain =
      fixture.prefix +
      fixture.mention +
      (hasLink ? fixture.linkHiddenPrefix + fixture.linkVisibleText : '') +
      fixture.suffix;
    expect(content).toBe(normalize(plain));
    expect(inner).not.toBe(content);
    if (!hasLink) expect(inner.length).toBe(content.length + 2);
    if (hasLink) {
      const link = text.locator(`a[href="${fixture.linkUrl}"]`);
      expect(await link.innerText()).toBe(fixture.linkVisibleText);
      expect(await link.textContent()).toBe(
        fixture.linkHiddenPrefix + fixture.linkVisibleText,
      );
    }
    const result = extract(textContentAnswer('910', kind), '910', {
      instruction: null,
    });
    if (result.kind !== 'read')
      throw new Error('Generated layout note was not read.');
    const compared = await compareFocal(
      page,
      { ...result.post, anonymous: null, signedIn: null },
      result.displayText,
      result.displayLinks,
    );
    expect(compared.matches).toBe(kind === 'mention' || kind === 'hidden-link');
    expect(Reflect.get(compared, 'textBasis')).toBe(
      kind === 'mention' || kind === 'hidden-link' ? 'textContent' : 'none',
    );
    if (compared.matches) {
      expect(compared.stored.textLength).toBe(content.length);
      expect(compared.shown.textLength).toBe(content.length);
    }
    expect(JSON.stringify(compared)).not.toContain(textContentStoredText(kind));
  });

test('parent notice above the focal notice accepts by positional answer alignment', async ({
  page,
}) => {
  await page.setContent(noticeAlignmentMarkup());
  expect(await page.locator('[role="article"]').count()).toBe(2);
  expect(
    await compareNotice(
      page,
      'tombstone',
      noticeAlignmentFromAnswer(noticeAlignmentAnswer('910'), '910'),
    ),
  ).toMatchObject({
    stored: { textLength: 0, photos: 0, videos: 0 },
    shown: { textLength: 0, photos: 0, videos: 0 },
    matches: true,
    notices: { beforeFocal: 1, candidatesSeen: 2, matchedIndex: 1 },
  });
});

for (const kind of [
  'identical-parent',
  'normal-parent-reply',
  'wrong-focal',
  'wrong-parent',
  'missing-candidate',
  'unavailable-parent',
  'delayed',
] as const)
  test(`positional notice alignment ${kind} requires the answer prefix and ignores replies below`, async ({
    page,
  }) => {
    await page.setContent(noticeAlignmentMarkup(kind));
    const matched = ![
      'wrong-focal',
      'wrong-parent',
      'missing-candidate',
    ].includes(kind);
    const compared = await compareNotice(
      page,
      'tombstone',
      noticeAlignmentFromAnswer(noticeAlignmentAnswer('910', kind), '910'),
    );
    expect(compared).toMatchObject({
      stored: { textLength: 0, photos: 0, videos: 0 },
      shown: { textLength: 0, photos: 0, videos: 0 },
      matches: matched,
      notices: {
        beforeFocal: kind === 'normal-parent-reply' ? 0 : 1,
        candidatesSeen: kind === 'missing-candidate' ? 1 : 2,
        matchedIndex: matched ? (kind === 'normal-parent-reply' ? 0 : 1) : null,
      },
    });
    for (const text of [
      NOTICE_ALIGNMENT_FIXTURE.parentText,
      NOTICE_ALIGNMENT_FIXTURE.focalText,
      NOTICE_ALIGNMENT_FIXTURE.replyText,
    ])
      expect(JSON.stringify(compared)).not.toContain(text);
  });

for (const kind of ['empty', 'present', 'late', 'transient', 'error'] as const)
  test(`empty direct focal ${kind} agrees only with bounded observed absence, not neighbouring articles`, async ({
    page,
  }) => {
    await page.setContent(
      '<button data-testid="SideNav_AccountSwitcher_Button">Generated account</button>' +
        emptyFocalMarkup('910', kind),
    );
    const compared = await compareEmptyFocal(page, '910');
    expect(compared).toMatchObject({
      stored: { textLength: 0, photos: 0, videos: 0 },
      shown: { textLength: 0, photos: 0, videos: 0 },
      matches: kind === 'empty',
      absence: {
        focalArticles: kind === 'present' || kind === 'late' ? 1 : 0,
        errorDetails: kind === 'error' ? 1 : 0,
        accountSwitchers: 1,
        accountVisible: true,
        focalObserved: ['present', 'late', 'transient'].includes(kind),
        errorObserved: kind === 'error',
        focalAbsent: kind !== 'present' && kind !== 'late',
      },
    });
    expect(await page.getByTestId('tweet').count()).toBe(
      kind === 'present' || kind === 'late' ? 3 : 2,
    );
    expect(JSON.stringify(compared)).not.toContain('Generated neighbour post');
  });

for (const present of [false, true])
  test(`R13 SelfThread empty answer requires focal absence, rendered=${present}`, async ({
    page,
  }) => {
    await page.setContent(
      '<html lang="de"><button data-testid="SideNav_AccountSwitcher_Button">Generated account</button>' +
        selfThreadEmptyMarkup('910', present) +
        '</html>',
    );
    expect(await page.getByTestId('tweet').count()).toBe(
      SELF_THREAD_EMPTY_FIXTURE.renderedIds.length + Number(present),
    );
    expect(await page.getByTestId('cellInnerDiv').count()).toBe(
      SELF_THREAD_EMPTY_FIXTURE.emptyCells,
    );
    expect(await page.getByTestId('error-detail').count()).toBe(0);
    expect(await compareEmptyFocal(page, '910')).toMatchObject({
      matches: !present,
      absence: {
        focalArticles: Number(present),
        errorDetails: 0,
        accountSwitchers: 1,
        accountVisible: true,
        focalObserved: present,
        errorObserved: false,
        focalAbsent: !present,
      },
    });
  });

for (const account of ['absent', 'hidden', 'duplicate'] as const)
  test(`empty focal with ${account} account switcher does not prove signed-in absence`, async ({
    page,
  }) => {
    const button =
      '<button data-testid="SideNav_AccountSwitcher_Button">Generated account</button>';
    await page.setContent(
      (account === 'absent'
        ? ''
        : account === 'hidden'
          ? button.replace('<button ', '<button style="display:none" ')
          : button + button) + emptyFocalMarkup('910'),
    );
    expect((await compareEmptyFocal(page, '910')).matches).toBe(false);
  });

for (const kind of [
  'match',
  'different-path',
  'in-full-text',
  'not-trailing',
] as const)
  test(`inline unavailable quote permalink ${kind} drops only the answer-bound trailing anchor`, async ({
    page,
  }) => {
    await page.setContent(inlineQuoteMarkup('910', kind));
    const text = page.getByTestId('tweetText');
    expect(await text.locator('a').count()).toBe(1);
    expect(await text.locator('a').innerText()).toContain('…');
    expect(await text.locator('a').textContent()).toContain('…');
    expect(await text.locator('a').innerText()).not.toBe(
      await text.locator('a').textContent(),
    );
    expect(
      await page
        .locator('article[data-testid="tweet"] div[role="link"]')
        .count(),
    ).toBe(0);
    const extracted = extract(inlineQuoteAnswer('910', kind), '910', {
      instruction: null,
    });
    if (extracted.kind !== 'read')
      throw new Error('Generated inline quote was not read.');
    const result = await compareFocal(
      page,
      { ...extracted.post, anonymous: null, signedIn: null },
      extracted.displayText,
      extracted.displayLinks,
      false,
      extracted.inlineQuote,
      extracted.statusLinks,
    );
    expect(result.matches).toBe(kind === 'match');
    if (kind === 'match')
      expect(result).toMatchObject({
        stored: { textLength: INLINE_QUOTE_FIXTURE.text.length },
        shown: { textLength: INLINE_QUOTE_FIXTURE.text.length },
      });
  });

test('R1 inline quote removal respects the DOM tail and case-insensitive relative path, not only equal suffix text', async ({
  page,
}) => {
  const extracted = extract(inlineQuoteAnswer('910'), '910', {
    instruction: null,
  });
  if (extracted.kind !== 'read')
    throw new Error('Generated inline quote not read.');
  const original = { ...extracted.post, anonymous: null, signedIn: null };
  const markup = inlineQuoteMarkup('910').replace(
    INLINE_QUOTE_FIXTURE.href,
    '/GENERATED_QUOTE/status/901/',
  );
  await page.setContent(markup);
  expect(
    (
      await compareFocal(
        page,
        original,
        extracted.displayText,
        extracted.displayLinks,
        false,
        extracted.inlineQuote,
      )
    ).matches,
  ).toBe(true);
  await page.setContent(
    markup.replace(
      '</a></div></article>',
      '</a><span style="display:none">Generated hidden trailing text</span></div></article>',
    ),
  );
  expect(
    (
      await compareFocal(
        page,
        original,
        extracted.displayText,
        extracted.displayLinks,
        false,
        extracted.inlineQuote,
      )
    ).matches,
  ).toBe(false);
});

for (const kind of [
  'match',
  'different-path',
  'outside-range',
  'non-status',
  'duplicate',
] as const)
  test(`R5 status entity ${kind} compares only one exact in-range status link`, async ({
    page,
  }) => {
    await page.setContent(statusEntityMarkup('910', kind));
    const text = page.getByTestId('tweetText');
    expect(await text.locator('a').first().innerText()).not.toBe(
      await text.locator('a').first().textContent(),
    );
    const extracted = extract(statusEntityAnswer('910', kind), '910', {
      instruction: null,
    });
    if (extracted.kind !== 'read')
      throw new Error('Generated status entity not read.');
    expect(extracted.displayLinks).toEqual([]);
    const compared = await compareFocal(
      page,
      { ...extracted.post, anonymous: null, signedIn: null },
      extracted.displayText,
      extracted.displayLinks,
      false,
      extracted.inlineQuote,
      extracted.statusLinks,
    );
    expect(compared.matches).toBe(kind === 'match');
    expect(extracted.post.text).toContain(STATUS_ENTITY_FIXTURE.url);
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
  const server = await startConfirmation(initial, TEST_PORTS.confirmation);
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
