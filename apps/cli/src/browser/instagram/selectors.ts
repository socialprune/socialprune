import type { Locator, Page } from 'playwright-core';
import type { Item } from '@socialprune/core';
import { ContextStop } from './report.ts';
import { normalize, ownerName } from './plan.ts';

export const SECOND_SOURCE_KEYS = Object.freeze({
  code: 'code',
  owner: ['user', 'username'],
  time: 'taken_at',
  caption: ['caption', 'text'],
  image: ['image_versions2', 'candidates'],
});
export const CLICK_NAMES = [
  'Sort & filter',
  'Oldest to newest',
  'Newest to oldest',
  'Apply',
  'Load more comments',
  'View replies',
] as const;
export type Click =
  | { kind: 'named'; name: (typeof CLICK_NAMES)[number] }
  | { kind: 'row'; index: number };
export function rows(page: Page): Locator {
  return page
    .locator('[role="button"][aria-label]')
    .filter({ has: page.locator('img') });
}
export async function clickAllowed(
  page: Page,
  click: Click,
  before: () => void,
): Promise<void> {
  before();
  await checkPage(page);
  let locator: Locator;
  if (
    click.kind === 'named' &&
    CLICK_NAMES.some((name) => name === click.name)
  ) {
    locator = page.getByRole('button', { name: click.name, exact: true });
    if (click.name === 'View replies')
      locator = page
        .locator('article')
        .getByRole('button', { name: click.name, exact: true })
        .first();
  } else if (
    click.kind === 'row' &&
    Number.isSafeInteger(click.index) &&
    click.index >= 0
  )
    locator = rows(page).nth(click.index);
  else throw new ContextStop('UNEXPECTED_ACTION', 'unexpected-action');
  if ((await locator.count()) !== 1 || !(await locator.isVisible()))
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'filter-control');
  before();
  await locator.click({ timeout: 5000 });
}
export async function checkPage(page: Page): Promise<void> {
  if (page.isClosed())
    throw new ContextStop('PLATFORM_CHECK', 'browser-closed');
  const path = new URL(page.url()).pathname;
  for (const [pattern, token] of [
    [/\/accounts\/login/, 'login'],
    [/\/challenge/, 'challenge'],
    [/\/checkpoint/, 'checkpoint'],
  ] as const)
    if (pattern.test(path)) throw new ContextStop('PLATFORM_CHECK', token);
  const lang = await page.locator('html').getAttribute('lang');
  if (!lang?.toLowerCase().startsWith('en'))
    throw new ContextStop('PAGE_LANGUAGE', 'page-language');
  for (const [text, token] of [
    ['Try again later', 'rate-limit'],
    ['Something went wrong', 'notice-error'],
    ['Your account has been suspended', 'locked'],
    ['Your account has been locked', 'locked'],
  ] as const)
    if (await page.getByText(text, { exact: true }).count())
      throw new ContextStop('PLATFORM_CHECK', token);
}
const AGE_UNITS =
  '(?:y|w|d|h|m|s|years?|weeks?|days?|hours?|minutes?|seconds?)';
const ROW_PATTERN = new RegExp(
  `^([A-Za-z0-9_.]{1,30})\\s+(.+?)\\s+(\\d+\\s*${AGE_UNITS})$`,
);
const AGE_PATTERN = new RegExp(`^(\\d+)\\s*(${AGE_UNITS})$`);
/** Coarse oldest-list diagnostic only; comment confirmation uses permalink time. */
export function relativeAgeMs(value: string): number | null {
  const match = AGE_PATTERN.exec(value);
  if (!match) return null;
  // A displayed year is rounded by Instagram. Use an average calendar year for
  // this diagnostic, never as evidence of a comment's exact creation time.
  const units: Record<string, number> = {
    y: 31557600000,
    w: 604800000,
    d: 86400000,
    h: 3600000,
    m: 60000,
    s: 1000,
  };
  const age = Number(match[1]) * units[match[2]![0]!]!;
  return Number.isFinite(age) ? age : null;
}
export interface RowReadCounts {
  /** Maximum simultaneous empty matches seen within one list load. */
  emptySkipped: number;
}
export async function readRows(
  page: Page,
  counts?: RowReadCounts,
): Promise<{ username: string; text: string; age: string; index: number }[]> {
  const result = [];
  const entries = rows(page);
  const texts = await entries.allInnerTexts();
  if (counts)
    counts.emptySkipped = Math.max(
      counts.emptySkipped,
      texts.filter((text) => !normalize(text)).length,
    );
  for (let index = 0; index < texts.length; index++) {
    const raw = normalize(texts[index]!);
    if (!raw) continue;
    const match = ROW_PATTERN.exec(raw);
    if (!match)
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'row-structure');
    result.push({
      username: match[1]!,
      text: match[2]!,
      age: match[3]!,
      index,
    });
  }
  return result;
}
export function rowCandidate(shown: string, expected: string): boolean {
  const value = normalize(shown),
    target = normalize(expected);
  if (value === target) return true;
  const prefix = value.replace(/(?:\u2026|\.\.\.)$/, '');
  return prefix !== value && prefix.length >= 20 && target.startsWith(prefix);
}
export function utcWindow(at: string): [string, string] {
  const date = new Date(at).getTime();
  return [
    new Date(date - 86400000).toISOString().slice(0, 10),
    new Date(date + 86400000).toISOString().slice(0, 10),
  ];
}
export function postAddress(
  input: string,
  origin: string,
): { kind: 'p' | 'reel'; code: string } | null {
  try {
    const url = new URL(input),
      match = /^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/$/.exec(url.pathname);
    return url.origin === origin && match
      ? { kind: match[1] as 'p' | 'reel', code: match[2]! }
      : null;
  } catch {
    return null;
  }
}
export interface PostProjection {
  kind: 'p' | 'reel';
  code: string;
  owner: string;
  ownerCount: number;
  caption: string | null;
  captionComplete: boolean;
  createdAt: string | null;
  comments: { username: string; text: string; id: string; createdAt: string }[];
  element: Locator;
}
function timestamp(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export async function readPost(
  page: Page,
  origin: string,
): Promise<PostProjection> {
  const address = postAddress(page.url(), origin);
  if (!address)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const element = page.locator('article');
  if ((await element.count()) !== 1)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const owners = element.locator('header a[href]');
  const names: string[] = [];
  for (const anchor of await owners.all()) {
    const name = normalize(await anchor.innerText());
    if (
      /^[A-Za-z0-9_.]{1,30}$/.test(name) &&
      (await anchor.getAttribute('href'))?.replace(/\/$/, '') === '/' + name
    )
      names.push(name);
  }
  if (!names.length)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const ownTime = element.locator(
    `a[href="/${address.kind}/${address.code}/"] time[datetime]`,
  );
  const createdAt =
    (await ownTime.count()) === 1
      ? timestamp(await ownTime.getAttribute('datetime'))
      : null;
  const comments = [];
  for (const block of await element.locator('ul li').all()) {
    const profile = block
      .locator('a[href]')
      .filter({ hasNot: page.locator('time') })
      .first();
    const username = (await profile.count())
      ? normalize(await profile.innerText())
      : '';
    if (
      !/^[A-Za-z0-9_.]{1,30}$/.test(username) ||
      (await profile.getAttribute('href')) !== `/${username}/`
    )
      continue;
    const content = block.locator('span').first();
    if ((await content.count()) !== 1) continue;
    const text = normalize(await content.innerText());
    // A second timestamped candidate remains ambiguous even when both links
    // occur in the same comment block. Never discard the whole block.
    for (const permalink of await block.locator('a[href*="/c/"]').all()) {
      const href = await permalink.getAttribute('href');
      const match = new RegExp(
        `^/${address.kind}/${address.code}/c/([0-9]{1,40})/$`,
      ).exec(href ?? '');
      const time = permalink.locator('time[datetime]');
      if (!match || (await time.count()) !== 1) continue;
      const at = timestamp(await time.getAttribute('datetime'));
      if (at) comments.push({ username, text, id: match[1]!, createdAt: at });
    }
  }
  const captionBlock = element
    .locator('div')
    .filter({ has: page.locator(`a[href="/${names[0]}/"]`) })
    .filter({ hasNot: page.locator('header,ul') });
  // The caption is the owner's own non-comment block, not text from other comments.
  const captionText = captionBlock.locator(':scope > span');
  const complete =
    (await captionBlock
      .getByRole('button', { name: 'more', exact: true })
      .count()) === 0;
  const shownCaption =
    (await captionText.count()) === 1
      ? normalize(await captionText.innerText())
      : '';
  const caption = shownCaption ? shownCaption.slice(0, 10000) : null;
  return {
    ...address,
    owner: names[0]!,
    ownerCount: names.length,
    caption,
    captionComplete: complete && shownCaption.length <= 10000,
    createdAt,
    comments,
    element,
  };
}
export type ConfirmationResult =
  | { state: 'confirmed'; comment: PostProjection['comments'][number] }
  | {
      state: 'unconfirmed';
      code: 'owner' | 'time' | 'text' | 'several' | 'not-shown';
    };
export function confirmComment(
  post: PostProjection,
  item: Item,
  handle: string,
): ConfirmationResult {
  if (ownerName(post.owner) !== ownerName(item.reference.ownerHandle ?? ''))
    return { state: 'unconfirmed', code: 'owner' };
  const own = post.comments.filter(
    (comment) => ownerName(comment.username) === ownerName(handle),
  );
  const text = own.filter((comment) => comment.text === normalize(item.text));
  const passed = text.filter(
    (comment) =>
      Math.abs(Date.parse(comment.createdAt) - Date.parse(item.createdAt)) <=
      60000,
  );
  if (passed.length === 1) return { state: 'confirmed', comment: passed[0]! };
  return {
    state: 'unconfirmed',
    code:
      passed.length > 1
        ? 'several'
        : text.length
          ? 'time'
          : own.some(
                (comment) =>
                  Math.abs(
                    Date.parse(comment.createdAt) - Date.parse(item.createdAt),
                  ) <= 60000,
              )
            ? 'text'
            : 'not-shown',
  };
}
/** Chromium DOM snapshots expose currentSrc without evaluating page JavaScript. */
export async function currentImageSource(page: Page): Promise<string | null> {
  const client = await page.context().newCDPSession(page);
  try {
    const root = await client.send('DOM.getDocument');
    const image = await client.send('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: 'article img:not(header img):not(ul img)',
    });
    if (!image.nodeId) return null;
    const node = await client.send('DOM.describeNode', {
      nodeId: image.nodeId,
    });
    const snapshot = await client.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [],
    });
    for (const document of snapshot.documents) {
      const index =
          document.nodes.backendNodeId?.indexOf(node.node.backendNodeId) ?? -1,
        sources = document.nodes.currentSourceURL;
      const position = sources?.index.indexOf(index) ?? -1;
      if (position >= 0)
        return snapshot.strings[sources!.value[position]!] ?? null;
    }
    return null;
  } finally {
    await client.detach();
  }
}
