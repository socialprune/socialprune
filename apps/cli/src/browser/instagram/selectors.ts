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
export const POST_SCROLL_ACTION = 'post-comments-wheel' as const;
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
        .locator('main')
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
  /** Maximum simultaneous other-name rows within one step's list loads. */
  otherName: number;
}
export function accountMatches(
  expected: string,
  outsideProfilePaths: readonly string[],
  entries: readonly { username: string }[],
): boolean {
  const handle = expected.toLowerCase();
  return (
    outsideProfilePaths.some(
      (path) =>
        /^\/[A-Za-z0-9_.]{1,30}\/$/.test(path) &&
        path.toLowerCase() === `/${handle}/`,
    ) &&
    entries.filter((row) => row.username.toLowerCase() === handle).length >
      entries.length / 2
  );
}
export async function outsideProfilePaths(page: Page): Promise<string[]> {
  const anchors = page.locator('xpath=//a[@href][not(ancestor::main)]'),
    origin = new URL(page.url()).origin,
    paths: string[] = [];
  for (const anchor of await anchors.all()) {
    const href = await anchor.getAttribute('href');
    if (href === null) continue;
    try {
      const url = new URL(href, origin);
      if (
        url.origin === origin &&
        url.href === url.origin + url.pathname &&
        (href === url.pathname || href === url.href)
      )
        paths.push(url.pathname);
    } catch {
      continue;
    }
  }
  return paths;
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
      match = /^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url.pathname);
    return url.origin === origin && input === origin + url.pathname && match
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
  ownerMatchesProfile: boolean;
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
  const element = await postElement(page, origin);
  if (!element)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const ownLinks = await postLinks(element, address);
  if (!ownLinks.length)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const names = new Set(ownLinks.map((link) => ownerName(link.owner)));
  const owner = ownLinks[0]!.owner;
  const profiles = await profileLinks(element);
  const firstProfile = profiles[0];
  const firstTextProfile = profiles.find((profile) => profile.text !== '');
  const ownerMatchesProfile =
    firstProfile !== undefined &&
    ownerName(firstProfile.username) === ownerName(owner) &&
    firstTextProfile !== undefined &&
    ownerName(firstTextProfile.username) === ownerName(owner) &&
    firstTextProfile.text === firstTextProfile.username;
  const times = new Set(ownLinks.map((link) => link.createdAt));
  const createdAt = times.size === 1 ? ownLinks[0]!.createdAt : null;
  const comments = [];
  for (const permalink of await element.locator('a[href*="/c/"]').all()) {
    const match = new RegExp(
      `^/(?:p|reel)/${address.code}/c/([0-9]{1,40})/$`,
    ).exec((await permalink.getAttribute('href')) ?? '');
    const time = permalink.locator('time[datetime]');
    if (!match || (await time.count()) !== 1) continue;
    const at = timestamp(await time.getAttribute('datetime'));
    if (!at) continue;
    const block = permalink.locator('xpath=ancestor::*[3]');
    if ((await block.locator('xpath=ancestor::main').count()) !== 1) continue;
    const content = await textBlock(block);
    if (!content?.text) continue;
    // Each timestamped permalink remains a candidate, including two in one
    // block. Ambiguous matching comments must still settle as several.
    comments.push({
      username: content.username,
      text: content.text,
      id: match[1]!,
      createdAt: at,
    });
  }
  const captions = [];
  let captionBlockSeen = false;
  for (const profile of profiles) {
    if (ownerName(profile.username) !== ownerName(owner) || !profile.text)
      continue;
    const row = profile.element.locator('xpath=ancestor::*[4]');
    if (
      (await row.locator('xpath=ancestor::main').count()) !== 1 ||
      (await row.locator('a[href*="/c/"]').count()) !== 0
    )
      continue;
    captionBlockSeen = true;
    const block = row.locator('xpath=ancestor::*[3]');
    const content = await captionText(block, owner);
    if (content !== null)
      captions.push({
        text: content,
        complete:
          (await block
            .getByRole('button', { name: 'more', exact: true })
            .count()) === 0,
      });
  }
  const caption = captions.length === 1 ? captions[0]! : null;
  return {
    ...address,
    owner,
    ownerCount: names.size,
    ownerMatchesProfile,
    caption: caption?.text.slice(0, 10000) ?? null,
    captionComplete: caption
      ? caption.complete && caption.text.length <= 10000
      : !captionBlockSeen,
    createdAt,
    comments,
    element,
  };
}
async function profileLinks(element: Locator) {
  const profiles = [];
  for (const anchor of await element.locator('a[href]').all()) {
    const match = /^\/([A-Za-z0-9_.]{1,30})\/$/.exec(
      (await anchor.getAttribute('href')) ?? '',
    );
    if (match)
      profiles.push({
        username: match[1]!,
        text: normalize(await anchor.innerText()),
        element: anchor,
      });
  }
  return profiles;
}
async function textBlock(block: Locator) {
  if (
    (await block.locator('xpath=self::div').count()) !== 1 ||
    (await block.locator(':scope > *').count()) !== 2 ||
    (await block.locator(':scope > div').count()) !== 2
  )
    return null;
  const row = block.locator(':scope > div').first();
  if (
    (await row.locator(':scope > *').count()) !== 2 ||
    (await row.locator(':scope > span[dir="auto"]').count()) !== 2
  )
    return null;
  const profiles = await profileLinks(row);
  if (profiles.length !== 1) return null;
  const profile = profiles[0]!;
  if (
    profile.text !== profile.username ||
    (await profile.element.locator('img').count()) !== 0
  )
    return null;
  // Name and time occupy the first row. Only the separate text row can supply
  // content; its hashtags and mentions remain text, never author evidence.
  const textRow = block.locator(':scope > div').nth(1);
  const text = textRow.locator(':scope > span[dir="auto"]');
  if (
    (await textRow.locator(':scope > *').count()) !== 1 ||
    (await text.count()) !== 1 ||
    (await text
      .locator('xpath=ancestor::a | ancestor::span[@dir="auto"]')
      .count()) !== 0 ||
    (await text
      .locator('time,button,img,[role="button"],a[href*="/c/"]')
      .count()) !== 0
  )
    return null;
  return {
    username: profile.username,
    text: normalize(await text.innerText()),
  };
}
async function captionText(
  block: Locator,
  owner: string,
): Promise<string | null> {
  if (
    (await block.locator('xpath=self::div').count()) !== 1 ||
    (await block.locator('xpath=ancestor::main').count()) !== 1 ||
    (await block.locator('a[href*="/c/"]').count()) !== 0 ||
    (await block.locator(':scope > *').count()) !== 2 ||
    (await block.locator(':scope > span[dir="auto"]').count()) !== 1 ||
    (await block.locator(':scope > div').count()) !== 1
  )
    return null;
  const wrapper = block.locator(':scope > span[dir="auto"]');
  const content = wrapper.locator(':scope > div');
  if (
    (await wrapper.locator(':scope > *').count()) !== 1 ||
    (await content.count()) !== 1 ||
    (await content.locator(':scope > *').count()) !== 2 ||
    (await content.locator(':scope > div').count()) !== 1 ||
    (await content.locator(':scope > span:not([dir])').count()) !== 1
  )
    return null;
  const row = content.locator(':scope > div');
  const profiles = await profileLinks(row);
  const time = row.locator('time[datetime]');
  if (
    profiles.length !== 1 ||
    profiles[0]!.text !== profiles[0]!.username ||
    ownerName(profiles[0]!.username) !== ownerName(owner) ||
    (await profiles[0]!.element.locator('img').count()) !== 0 ||
    (await time.count()) !== 1 ||
    (await time.locator('xpath=ancestor::a').count()) !== 0 ||
    timestamp(await time.getAttribute('datetime')) === null
  )
    return null;
  const text = content.locator(':scope > span:not([dir])');
  if (
    (await text
      .locator('time,img,button,[role="button"],a[href*="/c/"]')
      .count()) !== 0
  )
    return null;
  return normalize(await text.innerText());
}
async function postLinks(
  element: Locator,
  address: { kind: 'p' | 'reel'; code: string },
) {
  const links = [];
  const pattern = new RegExp(
    `^/([A-Za-z0-9_.]{1,30})/(?:p|reel)/${address.code}/$`,
  );
  for (const anchor of await element.locator('a[href]').all()) {
    const match = pattern.exec((await anchor.getAttribute('href')) ?? '');
    if (!match) continue;
    const time = anchor.locator('time[datetime]');
    links.push({
      owner: match[1]!,
      createdAt:
        (await time.count()) === 1
          ? timestamp(await time.getAttribute('datetime'))
          : null,
    });
  }
  return links;
}
export async function postElement(
  page: Page,
  origin: string,
): Promise<Locator | null> {
  const address = postAddress(page.url(), origin);
  const element = page.locator('main');
  if (!address || (await element.count()) !== 1) return null;
  const links = await postLinks(element, address);
  return links.some((link) => link.createdAt !== null) ? element : null;
}
export async function scrollPostComments(
  page: Page,
  origin: string,
  before: () => void,
): Promise<boolean> {
  before();
  await checkPage(page);
  const element = await postElement(page, origin);
  const address = postAddress(page.url(), origin);
  if (!element || !address) return false;
  let permalink: Locator | undefined;
  let href: string | null = null;
  for (const link of await element.locator('a[href*="/c/"]').all()) {
    const value = await link.getAttribute('href');
    if (
      new RegExp(`^/(?:p|reel)/${address.code}/c/[0-9]{1,40}/$`).test(
        value ?? '',
      ) &&
      (await link.locator('time[datetime]').count()) === 1
    ) {
      permalink = link;
      href = value;
      break;
    }
  }
  if (!permalink || !href) return false;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const root = await client.send('DOM.getDocument', { depth: -1 });
    const main = await client.send('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: 'main',
    });
    const target = await client.send('DOM.querySelector', {
      nodeId: main.nodeId,
      selector: `a[href="${href}"]`,
    });
    type Node = typeof root.root;
    const pathTo = (node: Node): Node[] | null => {
      if (node.nodeId === target.nodeId) return [node];
      for (const child of node.children ?? []) {
        const path = pathTo(child);
        if (path) return [node, ...path];
      }
      return null;
    };
    const path = pathTo(root.root)?.filter((node) => node.nodeType === 1);
    if (!path) return false;
    const ancestors = permalink.locator('xpath=ancestor::*');
    // Both paths are in document order. Stop at main rather than choosing a
    // page scroller outside the checked post's comment column.
    for (let index = path.length - 2; index >= 0; index--) {
      if (path[index]!.nodeId === main.nodeId) break;
      const style = await client.send('CSS.getComputedStyleForNode', {
        nodeId: path[index]!.nodeId,
      });
      if (
        !style.computedStyle.some(
          ({ name, value }) =>
            name === 'overflow-y' && (value === 'auto' || value === 'scroll'),
        )
      )
        continue;
      const box = await ancestors.nth(index).boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) return false;
      before();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      before();
      await page.mouse.wheel(0, 700);
      return true;
    }
    return false;
  } finally {
    await client.detach();
  }
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
  if (
    post.ownerCount !== 1 ||
    !post.ownerMatchesProfile ||
    ownerName(post.owner) !== ownerName(item.reference.ownerHandle ?? '')
  )
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
  const element = await postElement(page, new URL(page.url()).origin);
  if (!element) return null;
  let mediaIndex = -1;
  const images = await element.locator('img').all();
  for (const [index, image] of images.entries()) {
    if (
      (await image.locator('xpath=ancestor::a').count()) === 0 &&
      (await image
        .locator(
          'xpath=ancestor::*[*/a[contains(@href,"/c/")] or div/span/a[contains(@href,"/c/")]]',
        )
        .count()) === 0
    ) {
      mediaIndex = index;
      break;
    }
  }
  if (mediaIndex === -1) return null;
  const client = await page.context().newCDPSession(page);
  try {
    const root = await client.send('DOM.getDocument');
    const main = await client.send('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: 'main',
    });
    if (!main.nodeId) return null;
    const image = await client.send('DOM.querySelectorAll', {
      nodeId: main.nodeId,
      selector: 'img',
    });
    const nodeId = image.nodeIds[mediaIndex];
    if (!nodeId) return null;
    const node = await client.send('DOM.describeNode', {
      nodeId,
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
