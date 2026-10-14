import type { Page } from 'playwright-core';
import { object } from '@socialprune/core';
import type { Original } from '@socialprune/core';
import { xSelectors } from '../selectors.ts';
export interface CanaryCounts {
  textLength: number;
  photos: number;
  videos: number;
}
export interface CanaryComparison {
  stored: CanaryCounts;
  shown: CanaryCounts;
  matches: boolean;
  text?: DisplayTextComparison['text'];
}

/** Same one-pass decoder as adapter-x's internal tweet parser; no HTML parsing. */
export function decodeDisplayEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#[xX][0-9a-fA-F]+);/g,
    (entity) => {
      const body = entity.slice(1, -1);
      if (body[0] !== '#') return named[body]!;
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(
        body.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}

/** Transient focal display projection. The stored archive still keeps full text. */
export function displayTextFromAnswer(input: unknown): string {
  let tweet = object(input);
  if (tweet.__typename === 'TweetWithVisibilityResults')
    tweet = object(tweet.tweet);
  const legacy = object(tweet.legacy);
  const note = object(
    object(object(tweet.note_tweet).note_tweet_results).result,
  );
  if (typeof note.text === 'string') return decodeDisplayEntities(note.text);
  let display = typeof legacy.full_text === 'string' ? legacy.full_text : '';
  const range = legacy.display_text_range;
  const points = Array.from(display);
  if (
    Array.isArray(range) &&
    range.length === 2 &&
    typeof range[0] === 'number' &&
    Number.isSafeInteger(range[0]) &&
    typeof range[1] === 'number' &&
    Number.isSafeInteger(range[1]) &&
    range[0] >= 0 &&
    range[1] >= range[0] &&
    range[1] <= points.length
  )
    display = points.slice(range[0], range[1]).join('');
  display = decodeDisplayEntities(display);
  const media = object(legacy.entities).media;
  for (const entry of Array.isArray(media) ? media : []) {
    const url = object(entry).url;
    if (typeof url === 'string' && url.length)
      display = display.replaceAll(decodeDisplayEntities(url), '');
  }
  return display;
}

/** Only these metadata links may be hidden by a rendered card instead of text. */
export function displayLinksFromAnswer(input: unknown): string[] {
  let tweet = object(input);
  if (tweet.__typename === 'TweetWithVisibilityResults')
    tweet = object(tweet.tweet);
  const card = object(object(tweet.card).legacy);
  const bindings: unknown[] = Array.isArray(card.binding_values)
    ? card.binding_values
    : [];
  const binding = bindings.find((value) => object(value).key === 'card_url');
  const bound = object(object(binding).value).string_value;
  const cardUrl =
    typeof card.url === 'string' && card.url.length ? card.url : bound;
  const quoteUrl = object(object(tweet.legacy).quoted_status_permalink).url;
  return [
    ...new Set(
      [cardUrl, quoteUrl].filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    ),
  ];
}

export function removeUnrenderedDisplayLinks(
  text: string,
  candidates: readonly string[],
  anchorHrefs: readonly string[],
): string {
  const rendered = new Set(anchorHrefs);
  let result = text;
  for (const link of candidates)
    if (link && !rendered.has(link))
      result = result.replaceAll(decodeDisplayEntities(link), '');
  return result;
}

interface DisplayTextComparison {
  storedLength: number;
  shownLength: number;
  matches: boolean;
  text: {
    storedPlainLength: number;
    shownInnerTextLength: number;
    imageAltUnits: number;
    matchedImageAlts: number;
    imageSpacingUnits: number;
  };
}

export function compareDisplayText(
  stored: string,
  shown: string,
  alts: readonly (string | null)[],
): DisplayTextComparison {
  let cursor = 0,
    plain = '',
    matchedImageAlts = 0,
    found = true;
  const imageAltUnits = alts.reduce<number>(
    (sum, alt) => sum + (alt?.length ?? 0),
    0,
  );
  for (const alt of alts) {
    if (alt === null || !alt.length) {
      found = false;
      break;
    }
    const index = stored.indexOf(alt, cursor);
    if (index < 0) {
      found = false;
      break;
    }
    plain += stored.slice(cursor, index);
    cursor = index + alt.length;
    matchedImageAlts++;
  }
  plain += stored.slice(cursor);
  const normalizedPlain = plain.replace(/\s+/gu, ' ').trim();
  const normalizedShown = shown.replace(/\s+/gu, ' ').trim();
  const storedLength = normalizedLength(stored);
  const imageContribution = found
    ? storedLength - normalizedPlain.length
    : imageAltUnits;
  return {
    storedLength,
    // Reconstruct only the matched image positions from the display projection;
    // include separators lost by trimming innerText, and record them separately.
    shownLength: normalizedShown.length + imageContribution,
    matches:
      found &&
      matchedImageAlts === alts.length &&
      normalizedPlain === normalizedShown,
    text: {
      storedPlainLength: normalizedPlain.length,
      shownInnerTextLength: normalizedShown.length,
      imageAltUnits,
      matchedImageAlts,
      imageSpacingUnits: imageContribution - imageAltUnits,
    },
  };
}
export async function compareNotice(
  page: Page,
  status: 'not-found' | 'tombstone' | 'unavailable',
): Promise<CanaryComparison> {
  const marker =
    status === 'not-found'
      ? page.getByTestId('error-detail').filter({
          hasText:
            /^(?:This Post (?:doesn’t|doesn't) exist\.?|Dieser Post existiert nicht\.?)$/,
        })
      : page.getByTestId('error-detail').filter({
          hasText:
            status === 'tombstone'
              ? /^(?:This Post was deleted by the Post author\.?|Dieser Post wurde vom Autor gelöscht\.?)$/
              : /^(?:This Post is unavailable\.?|Dieser Post ist nicht verfügbar\.?)$/,
        });
  const zero = { textLength: 0, photos: 0, videos: 0 };
  return {
    stored: zero,
    shown: { ...zero },
    matches: (await marker.count()) === 1 && (await marker.isVisible()),
  };
}
export function normalizedLength(text: string): number {
  return text.replace(/\s+/gu, ' ').trim().length;
}
export async function compareFocal(
  page: Page,
  original: Original,
  displayText = original.text ?? '',
  displayLinks: readonly string[] = [],
): Promise<CanaryComparison> {
  const article = await xSelectors.focal(page, original.id);
  const own = (selector: string) =>
    article.locator(selector).and(
      page.locator(
        // Quote cards are divs; own media uses role-link photo anchors.
        `${selector}:not(article[data-testid="tweet"] div[role="link"] ${selector})`,
      ),
    );
  const text = own('[data-testid="tweetText"]'),
    textCount = await text.count();
  const shownText = textCount === 1 ? await text.innerText() : '';
  const links: { href: string; visible: string }[] = [];
  if (textCount === 1)
    for (const link of await text.locator('a[href]').all()) {
      const href = await link.getAttribute('href');
      if (href) links.push({ href, visible: await link.innerText() });
    }
  let storedText = removeUnrenderedDisplayLinks(
    displayText,
    displayLinks,
    links.map((link) => link.href),
  );
  // Compare exactly after whitespace and known rendered link substitutions.
  // Never allow a general length tolerance: a missing long-text tail must fail.
  for (const { href, visible } of links) {
    if (href && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(href) && visible)
      storedText = storedText.replaceAll(href, visible);
  }
  const alts: (string | null)[] = [];
  if (textCount === 1)
    for (const image of await text.locator('img').all())
      alts.push(await image.getAttribute('alt'));
  const textComparison = compareDisplayText(storedText, shownText, alts);
  const photos = own('[data-testid="tweetPhoto"]').filter({
      hasNot: page.locator('video,[data-testid="videoPlayer"]'),
    }),
    players = own('[data-testid="videoPlayer"]');
  const stored = {
    textLength: textComparison.storedLength,
    photos: original.media.filter((media) => media.kind === 'photo').length,
    videos: original.media.filter((media) => media.kind !== 'photo').length,
  };
  const shown = {
    textLength: textComparison.shownLength,
    photos: await photos.count(),
    videos: (await players.count()) || (await own('video').count()),
  };
  return {
    stored,
    shown,
    text: textComparison.text,
    matches:
      (textCount === 1 ||
        (textCount === 0 && normalizedLength(storedText) === 0)) &&
      original.textCompleteness === 'full' &&
      textComparison.matches &&
      JSON.stringify(stored) === JSON.stringify(shown),
  };
}
