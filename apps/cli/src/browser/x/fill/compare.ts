import type { Page } from 'playwright-core';
import { object } from '@socialprune/core';
import type { Original } from '@socialprune/core';
import { xSelectors } from '../selectors.ts';
import { setTimeout as sleep } from 'node:timers/promises';
export interface CanaryCounts {
  textLength: number;
  photos: number;
  videos: number;
}
export interface CanaryComparison {
  stored: CanaryCounts;
  shown: CanaryCounts;
  matches: boolean;
  text?: DisplayTextComparison['text'] & { shownTextContentLength?: number };
  textBasis?: 'innerText' | 'textContent' | 'none';
  notices?: {
    beforeFocal: number;
    candidatesSeen: number;
    matchedIndex: number | null;
  };
  absence?: EmptyFocalCounts & {
    focalAbsent: boolean;
    focalObserved: boolean;
    errorObserved: boolean;
  };
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

export interface InlineQuotePermalink {
  path: string;
}
export interface StatusEntityLink {
  url: string;
  path: string;
}
function statusPath(value: string): string | null {
  return /^\/[A-Za-z0-9_]{1,50}\/status\/\d{1,40}\/?$/i.test(value)
    ? value.replace(/\/$/, '').toLowerCase()
    : null;
}
function expandedStatusPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      ![
        'x.com',
        'twitter.com',
        'www.twitter.com',
        'mobile.twitter.com',
      ].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    return statusPath(url.pathname);
  } catch {
    return null;
  }
}
/** Only exact legacy URL entities inside the declared display range qualify. */
export function statusEntitiesFromAnswer(input: unknown): StatusEntityLink[] {
  let tweet = object(input);
  if (tweet.__typename === 'TweetWithVisibilityResults')
    tweet = object(tweet.tweet);
  const legacy = object(tweet.legacy),
    range = legacy.display_text_range;
  if (
    typeof legacy.full_text !== 'string' ||
    !Array.isArray(range) ||
    range.length !== 2 ||
    !Number.isSafeInteger(range[0]) ||
    !Number.isSafeInteger(range[1]) ||
    typeof range[0] !== 'number' ||
    typeof range[1] !== 'number' ||
    range[0] < 0 ||
    range[1] < range[0]
  )
    return [];
  const points = Array.from(legacy.full_text);
  if (range[1] > points.length) return [];
  const entries = object(legacy.entities).urls;
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const value = object(entry),
      indices = value.indices,
      path = expandedStatusPath(value.expanded_url);
    if (
      typeof value.url !== 'string' ||
      !/^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(value.url) ||
      !path ||
      !Array.isArray(indices) ||
      indices.length !== 2 ||
      !Number.isSafeInteger(indices[0]) ||
      !Number.isSafeInteger(indices[1]) ||
      typeof indices[0] !== 'number' ||
      typeof indices[1] !== 'number' ||
      indices[0] < range[0] ||
      indices[1] > range[1] ||
      indices[1] <= indices[0] ||
      points.slice(indices[0], indices[1]).join('') !== value.url
    )
      return [];
    return [{ url: value.url, path }];
  });
}
/** This projection is comparison-only; archive text and media are unchanged. */
export function inlineQuoteFromAnswer(
  input: unknown,
): InlineQuotePermalink | null {
  let tweet = object(input);
  if (tweet.__typename === 'TweetWithVisibilityResults')
    tweet = object(tweet.tweet);
  const legacy = object(tweet.legacy),
    permalink = object(legacy.quoted_status_permalink);
  if (
    legacy.is_quote_status !== true ||
    typeof legacy.full_text !== 'string' ||
    typeof permalink.url !== 'string' ||
    !/^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(permalink.url) ||
    legacy.full_text.includes(permalink.url) ||
    typeof permalink.expanded !== 'string'
  )
    return null;
  try {
    const url = new URL(permalink.expanded);
    if (
      url.protocol !== 'https:' ||
      ![
        'x.com',
        'twitter.com',
        'www.twitter.com',
        'mobile.twitter.com',
      ].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    const path = statusPath(url.pathname);
    return path ? { path } : null;
  } catch {
    return null;
  }
}
export function inlineQuoteMatches(
  href: string,
  quote: InlineQuotePermalink | null,
): boolean {
  return (
    quote !== null &&
    statusPath(href) !== null &&
    statusPath(href) === quote.path
  );
}
export function removeInlineQuoteSuffix(shown: string, label: string): string {
  const suffix = label.trim();
  const value = shown.trimEnd();
  return suffix && value.endsWith(suffix)
    ? value.slice(0, -suffix.length)
    : shown;
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

/** Each exact basis uses only its own anchor labels, never a mixed projection. */
export function compareDisplayTextBases(
  displayText: string,
  innerText: string,
  textContent: string,
  links: readonly { href: string; innerText: string; textContent: string }[],
  alts: readonly (string | null)[],
  displayLinks: readonly string[] = [],
  statusLinks: readonly StatusEntityLink[] = [],
): DisplayTextComparison & {
  textBasis: NonNullable<CanaryComparison['textBasis']>;
  text: DisplayTextComparison['text'] & { shownTextContentLength: number };
} {
  const mapped = statusLinks.map((entity) => ({
    entity,
    links: links.filter((link) => statusPath(link.href) === entity.path),
  }));
  const ambiguous = mapped.some(
    ({ entity, links: candidates }) =>
      candidates.length !== 1 ||
      statusLinks.filter(
        (value) => value.path === entity.path || value.url === entity.url,
      ).length > 1,
  );
  const substitutions = mapped.filter(
    ({ entity, links: candidates }) =>
      candidates.length === 1 && displayText.includes(entity.url),
  );
  const plain = removeUnrenderedDisplayLinks(displayText, displayLinks, [
    ...links.map((link) => link.href),
    ...substitutions.map(({ entity }) => entity.url),
  ]);
  const storedFor = (basis: 'innerText' | 'textContent') => {
    let stored = plain;
    for (const link of links)
      if (/^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(link.href) && link[basis])
        stored = stored.replaceAll(link.href, link[basis]);
    for (const { entity, links: candidates } of substitutions) {
      if (candidates[0]![basis])
        stored = stored.replace(entity.url, candidates[0]![basis]);
    }
    return stored;
  };
  const inner = compareDisplayText(storedFor('innerText'), innerText, alts);
  const content = compareDisplayText(
    storedFor('textContent'),
    textContent,
    alts,
  );
  const textBasis = ambiguous
    ? 'none'
    : inner.matches
      ? 'innerText'
      : content.matches
        ? 'textContent'
        : 'none';
  const chosen = textBasis === 'textContent' ? content : inner;
  return {
    ...chosen,
    matches: !ambiguous && chosen.matches,
    textBasis,
    text: {
      ...chosen.text,
      shownInnerTextLength: inner.text.shownInnerTextLength,
      shownTextContentLength: content.text.shownInnerTextLength,
    },
  };
}
export async function compareNotice(
  page: Page,
  status: 'not-found' | 'tombstone' | 'unavailable',
  alignment: NoticeAlignment | string | null = null,
): Promise<CanaryComparison> {
  const zero = { textLength: 0, photos: 0, videos: 0 };
  if (status === 'tombstone') {
    const expected =
      typeof alignment === 'string'
        ? {
            notices: [{ kind: 'tombstone' as const, text: alignment }],
            focalIndex: 0,
          }
        : alignment;
    const candidates = page.locator(
      '[role="article"]:not([data-testid="tweet"]):not(article[data-testid="tweet"] *):not([data-testid="error-detail"] *),[data-testid="error-detail"]',
    );
    const read = async () => {
      const count = await candidates.count();
      const shown: (string | null)[] = [];
      for (
        let index = 0;
        index < Math.min(count, (expected?.focalIndex ?? -1) + 1);
        index++
      ) {
        const candidate = candidates.nth(index);
        shown.push(
          !(await candidate.isVisible())
            ? null
            : expected?.notices[index]?.kind === 'unavailable'
              ? ''
              : await candidate.innerText(),
        );
      }
      return matchNoticeAlignment(expected, shown, count);
    };
    const render = await waitForFocalCounts(
      async () => {
        const current = await read();
        return {
          text: current.matches ? 1 : 0,
          photos: Math.min(
            current.candidatesSeen,
            (expected?.focalIndex ?? -1) + 1,
          ),
          videos: 0,
        };
      },
      { text: 1, photos: (expected?.focalIndex ?? -1) + 1, videos: 0 },
    );
    const current = await read();
    return {
      stored: zero,
      shown: { ...zero },
      notices: {
        beforeFocal: current.beforeFocal,
        candidatesSeen: current.candidatesSeen,
        matchedIndex: current.matchedIndex,
      },
      matches: render.settled && current.matches,
    };
  }
  const marker =
    status === 'not-found'
      ? page.getByTestId('error-detail').filter({
          hasText:
            /^(?:This Post (?:doesn’t|doesn't) exist\.?|Dieser Post existiert nicht\.?)$/,
        })
      : page.getByTestId('error-detail').filter({
          hasText:
            /^(?:This Post is unavailable\.?|Dieser Post ist nicht verfügbar\.?)$/,
        });
  return {
    stored: zero,
    shown: { ...zero },
    matches: (await marker.count()) === 1 && (await marker.isVisible()),
  };
}
export interface EmptyFocalCounts {
  focalArticles: number;
  errorDetails: number;
  accountSwitchers: number;
  accountVisible: boolean;
}
export function emptyFocalAgrees(counts: EmptyFocalCounts): boolean {
  return (
    counts.focalArticles === 0 &&
    counts.errorDetails === 0 &&
    counts.accountSwitchers === 1 &&
    counts.accountVisible
  );
}
/** No post content is inferred from absent neighbours or a matching notice. */
export async function compareEmptyFocal(
  page: Page,
  focalId: string,
): Promise<CanaryComparison> {
  const focal = xSelectors.focalLocator(page, focalId);
  const errors = page.getByTestId('error-detail');
  const switchers = page.getByTestId('SideNav_AccountSwitcher_Button');
  let focalObserved = false,
    errorObserved = false;
  const read = async (): Promise<EmptyFocalCounts> => {
    await xSelectors.check(page);
    const counts = {
      focalArticles: await focal.count(),
      errorDetails: await errors.count(),
      accountSwitchers: await switchers.count(),
      accountVisible: false,
    };
    counts.accountVisible =
      counts.accountSwitchers === 1 && (await switchers.isVisible());
    focalObserved ||= counts.focalArticles > 0;
    errorObserved ||= counts.errorDetails > 0;
    return counts;
  };
  const render = await waitForFocalCounts(
    async () => {
      const counts = await read();
      return {
        text: emptyFocalAgrees(counts) ? 1 : 0,
        photos: focalObserved ? Math.max(1, counts.focalArticles) : 0,
        videos: errorObserved ? Math.max(1, counts.errorDetails) : 0,
      };
    },
    { text: 1, photos: 0, videos: 0 },
  );
  const counts = await read();
  const zero = { textLength: 0, photos: 0, videos: 0 };
  return {
    stored: zero,
    shown: { ...zero },
    absence: {
      ...counts,
      focalAbsent: counts.focalArticles === 0,
      focalObserved,
      errorObserved,
    },
    matches:
      render.settled &&
      emptyFocalAgrees(counts) &&
      !focalObserved &&
      !errorObserved,
  };
}
export interface NoticeAlignment {
  notices: readonly {
    kind: 'tombstone' | 'unavailable';
    text: string | null;
  }[];
  focalIndex: number;
}
export function matchNoticeAlignment(
  expected: NoticeAlignment | null,
  shown: readonly (string | null)[],
  candidatesSeen = shown.length,
): {
  beforeFocal: number;
  candidatesSeen: number;
  matchedIndex: number | null;
  matches: boolean;
} {
  const index = expected?.focalIndex ?? -1;
  const focal = expected?.notices[index];
  const valid =
    Number.isSafeInteger(index) &&
    index >= 0 &&
    focal?.kind === 'tombstone' &&
    tombstoneNoticeMatches(focal.text ?? '', focal.text);
  const matches =
    valid &&
    candidatesSeen > index &&
    shown.length > index &&
    expected!.notices
      .slice(0, index + 1)
      .every(
        (entry, position) =>
          shown[position] !== null &&
          shown[position] !== undefined &&
          (entry.kind === 'unavailable'
            ? true
            : tombstoneNoticeMatches(shown[position], entry.text)),
      );
  return {
    beforeFocal: Math.max(0, index),
    candidatesSeen,
    matchedIndex: matches ? index : null,
    matches,
  };
}
export function tombstoneNoticeMatches(
  shown: string,
  answer: string | null,
): boolean {
  const normalized = answer?.replace(/\s+/gu, ' ').trim() ?? '';
  return (
    normalized.length > 0 &&
    shown.replace(/\s+/gu, ' ').trim().includes(normalized)
  );
}

/** Called only after extract accepted this page's focal tombstone; never persisted. */
export function noticeAlignmentFromAnswer(
  body: unknown,
  focalId: string,
): NoticeAlignment | null {
  const notices: NoticeAlignment['notices'][number][] = [];
  const instructions = object(
    object(object(body).data).threaded_conversation_with_injections_v2,
  ).instructions;
  for (const input of Array.isArray(instructions) ? instructions : []) {
    const instruction = object(input);
    const entries =
      instruction.type === 'TimelineReplaceEntry'
        ? [instruction.entry]
        : instruction.type === 'TimelineAddEntries' &&
            Array.isArray(instruction.entries)
          ? instruction.entries
          : [];
    for (const input of entries) {
      const entry = object(input),
        content = object(entry.content);
      const entries = Array.isArray(content.items)
        ? content.items.map((input) => ({
            id: object(input).entryId,
            content: object(object(input).item).itemContent,
            module: true,
          }))
        : [{ id: entry.entryId, content: content.itemContent, module: false }];
      for (const candidate of entries) {
        let result = object(
          object(object(candidate.content).tweet_results).result,
        );
        if (result.__typename === 'TweetWithVisibilityResults')
          result = object(result.tweet);
        const id =
          result.rest_id ??
          (typeof candidate.id === 'string'
            ? candidate.id.match(
                candidate.module
                  ? /^(?:conversationthread-\d{1,40}-)?tweet-(\d{1,40})$/
                  : /^tweet-(\d{1,40})$/,
              )?.[1]
            : null);
        if (id === focalId && result.__typename !== 'TweetTombstone')
          return null;
        if (result.__typename === 'TweetUnavailable') {
          notices.push({ kind: 'unavailable', text: null });
          continue;
        }
        if (result.__typename !== 'TweetTombstone') continue;
        if (typeof id !== 'string') return null;
        const text = object(object(result.tombstone).text).text;
        if (typeof text !== 'string' || !normalizedLength(text)) return null;
        notices.push({ kind: 'tombstone', text });
        if (id === focalId) return { notices, focalIndex: notices.length - 1 };
      }
    }
  }
  return null;
}
export function tombstoneTextFromAnswer(
  body: unknown,
  focalId: string,
): string | null {
  const alignment = noticeAlignmentFromAnswer(body, focalId);
  return alignment?.notices[alignment.focalIndex]?.text ?? null;
}
export function normalizedLength(text: string): number {
  return text.replace(/\s+/gu, ' ').trim().length;
}
export function expectedFocalMediaCounts(
  media: readonly { kind: string }[],
  gated: boolean,
): Pick<CanaryCounts, 'photos' | 'videos'> {
  return {
    photos: gated ? 0 : media.filter((entry) => entry.kind === 'photo').length,
    videos: gated ? 0 : media.filter((entry) => entry.kind !== 'photo').length,
  };
}

export const FOCAL_RENDER_WAIT = Object.freeze({
  deadlineMs: 10_000,
  settleMs: 1_000,
  minimumMs: 2_000,
  pollMs: 100,
});
interface FocalRenderCounts {
  text: number;
  photos: number;
  videos: number;
}
interface RenderClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
/** Repeated locator reads only; fixed timing is injectable only for unit proof. */
export async function waitForFocalCounts(
  read: () => Promise<FocalRenderCounts>,
  expected: { text?: number; photos: number; videos: number },
  clock: RenderClock = {
    now: () => performance.now(),
    sleep: async (ms) => {
      await sleep(ms);
    },
  },
): Promise<{ counts: FocalRenderCounts; settled: boolean }> {
  const started = clock.now();
  const deadline = started + FOCAL_RENDER_WAIT.deadlineMs;
  let previous: string | undefined;
  let unchangedSince = started;
  for (;;) {
    const counts = await read();
    const now = clock.now();
    const signature = JSON.stringify(counts);
    if (signature !== previous) {
      previous = signature;
      unchangedSince = now;
    }
    if (now > deadline) return { counts, settled: false };
    const equal =
      (expected.text === undefined || counts.text === expected.text) &&
      counts.photos === expected.photos &&
      counts.videos === expected.videos;
    if (
      equal &&
      now - started >= FOCAL_RENDER_WAIT.minimumMs &&
      now - unchangedSince >= FOCAL_RENDER_WAIT.settleMs
    )
      return { counts, settled: true };
    if (now >= deadline) return { counts, settled: false };
    await clock.sleep(Math.min(FOCAL_RENDER_WAIT.pollMs, deadline - now));
  }
}
export async function compareFocal(
  page: Page,
  original: Original,
  displayText = original.text ?? '',
  displayLinks: readonly string[] = [],
  mediaGated = false,
  inlineQuote: InlineQuotePermalink | null = null,
  statusLinks: readonly StatusEntityLink[] = [],
): Promise<CanaryComparison> {
  const article = await xSelectors.focal(page, original.id);
  const own = (selector: string) =>
    article.locator(selector).and(
      page.locator(
        // Quote cards are divs; own media uses role-link photo anchors.
        `${selector}:not(article[data-testid="tweet"] div[role="link"] ${selector})`,
      ),
    );
  const text = own('[data-testid="tweetText"]');
  const photos = own('[data-testid="tweetPhoto"]').filter({
    hasNot: page.locator('video,[data-testid="videoPlayer"]'),
  });
  const players = own('[data-testid="videoPlayer"]');
  const videos = own('video');
  const expectedMedia = expectedFocalMediaCounts(original.media, mediaGated);
  const render = await waitForFocalCounts(
    async () => ({
      text: await text.count(),
      photos: await photos.count(),
      videos: (await players.count()) || (await videos.count()),
    }),
    {
      ...expectedMedia,
      ...(normalizedLength(
        removeUnrenderedDisplayLinks(displayText, displayLinks, []),
      ) > 0
        ? { text: 1 }
        : {}),
    },
  );
  const textCount = await text.count();
  let shownText = textCount === 1 ? await text.innerText() : '';
  let shownContent = textCount === 1 ? ((await text.textContent()) ?? '') : '';
  const links: { href: string; innerText: string; textContent: string }[] = [];
  if (textCount === 1) {
    const trailing = text.locator(
      'xpath=.//a[@href][not(ancestor-or-self::*[ancestor::*[@data-testid="tweetText"]][following-sibling::* or following-sibling::text()[normalize-space(.) != ""]])]',
    );
    if (
      inlineQuote &&
      (await trailing.count()) === 1 &&
      inlineQuoteMatches(
        (await trailing.getAttribute('href')) ?? '',
        inlineQuote,
      )
    ) {
      shownText = removeInlineQuoteSuffix(
        shownText,
        await trailing.innerText(),
      );
      shownContent = removeInlineQuoteSuffix(
        shownContent,
        (await trailing.textContent()) ?? '',
      );
    }
    for (const link of await text.locator('a[href]').all()) {
      const href = await link.getAttribute('href');
      if (href)
        links.push({
          href,
          innerText: await link.innerText(),
          textContent: (await link.textContent()) ?? '',
        });
    }
  }
  const storedText = removeUnrenderedDisplayLinks(
    displayText,
    displayLinks,
    links.map((link) => link.href),
  );
  // Compare exactly after whitespace and known rendered link substitutions.
  // Never allow a general length tolerance: a missing long-text tail must fail.
  const alts: (string | null)[] = [];
  if (textCount === 1)
    for (const image of await text.locator('img').all())
      alts.push(await image.getAttribute('alt'));
  const textComparison = compareDisplayTextBases(
    displayText,
    shownText,
    shownContent,
    links,
    alts,
    displayLinks,
    statusLinks,
  );
  const stored = {
    textLength: textComparison.storedLength,
    ...expectedMedia,
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
    textBasis: textComparison.textBasis,
    matches:
      render.settled &&
      (textCount === 1 ||
        (textCount === 0 && normalizedLength(storedText) === 0)) &&
      original.textCompleteness === 'full' &&
      textComparison.matches &&
      JSON.stringify(stored) === JSON.stringify(shown),
  };
}
