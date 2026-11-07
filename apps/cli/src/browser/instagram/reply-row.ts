import type { Locator } from 'playwright-core';
import { normalize } from './plan.ts';
import { textBlock } from './selectors.ts';
import type { ReplyRowDiagnostic } from './report.ts';
import type { combinedReplyAnswer } from './replies-answer.ts';

export async function replyRowShape(
  row: Locator,
  handle: string,
  index: number,
): Promise<ReplyRowDiagnostic> {
  const shape: ReplyRowDiagnostic = {
    index,
    observed: false,
    observationFailed: true,
    directChildCount: 0,
    childrenCapped: false,
    children: [],
    divBlocks: 0,
    spansByDepth: Array<number>(12).fill(0),
    ownHandleLinks: 0,
    authorLinks: 0,
    authorDistinctHrefs: 0,
    permalinks: 0,
    times: 0,
    permalinkDepths: [],
    deeperPermalinks: 0,
    extraction: 'none',
    failedStep: 'none',
  };
  try {
    const children = row.locator(':scope > *');
    shape.directChildCount = await children.count();
    shape.childrenCapped = shape.directChildCount > 20;
    for (const child of (await children.all()).slice(0, 20)) {
      let tag: ReplyRowDiagnostic['children'][number]['tag'] = 'other';
      for (const candidate of [
        'div',
        'span',
        'a',
        'time',
        'button',
        'ul',
        'li',
      ] as const)
        if ((await child.locator(`xpath=self::${candidate}`).count()) === 1) {
          tag = candidate;
          break;
        }
      const raw = await child.getAttribute('role', { timeout: 150 });
      const role =
        raw === null
          ? null
          : ['button', 'link', 'list', 'listitem'].includes(raw)
            ? (raw as 'button' | 'link' | 'list' | 'listitem')
            : 'other';
      shape.children.push({ tag, role });
    }
    shape.divBlocks = await row.locator(':scope > div:not([role])').count();
    shape.permalinks = await row.locator('a[href*="/c/"]').count();
    shape.times = await row.locator('time[datetime]').count();
    for (let depth = 1; depth <= 12; depth++) {
      const prefix = ':scope' + ' > *'.repeat(depth - 1) + ' > ';
      shape.spansByDepth[depth - 1] = await row
        .locator(prefix + 'span[dir="auto"]')
        .count();
      const n = await row.locator(prefix + 'a[href*="/c/"]').count();
      for (let i = 0; i < n && shape.permalinkDepths.length < 20; i++)
        shape.permalinkDepths.push(depth);
    }
    shape.deeperPermalinks = Math.max(
      0,
      shape.permalinks - shape.permalinkDepths.length,
    );
    const profiles = new Set<string>();
    for (const link of await row.locator('a[href]').all()) {
      const href = await link.getAttribute('href', { timeout: 150 });
      if (href && /^\/[A-Za-z0-9_.]{1,30}\/$/.test(href)) {
        shape.authorLinks++;
        profiles.add(href.toLowerCase());
        if (href.toLowerCase() === `/${handle.toLowerCase()}/`)
          shape.ownHandleLinks++;
      }
    }
    shape.authorDistinctHrefs = profiles.size;
    shape.observed = true;
    shape.observationFailed = false;
  } catch {
    /* Counts unavailable; the extraction error remains authoritative. */
  }
  return shape;
}

/** The admitted page answer supplies content; the matched visible row proves presence. */
export async function readAnswerBoundReply(
  row: Locator,
  address: { kind: 'p' | 'reel'; code: string },
  answer: ReturnType<typeof combinedReplyAnswer>['answer'],
  diagnostic: ReplyRowDiagnostic,
) {
  diagnostic.failedStep = 'answer-id';
  const links = row.locator('a[href*="/c/"]');
  if (!answer.present || !answer.valid || (await links.count()) !== 1)
    return null;
  const href = await links.getAttribute('href', { timeout: 150 });
  const id = href
    ? new RegExp(`^/${address.kind}/${address.code}/c/([0-9]{1,40})/$`).exec(
        href,
      )?.[1]
    : undefined;
  if (!id) return null;
  const matches = answer.entries.filter((entry) => entry.id === id);
  if (matches.length !== 1) return null;
  const entry = matches[0]!;
  diagnostic.failedStep = 'answer-time';
  const time = links.locator('time[datetime]');
  if (
    (await time.count()) !== 1 ||
    (await row.locator('time[datetime]').count()) !== 1
  )
    return null;
  const rawTime = await time.getAttribute('datetime', { timeout: 150 });
  if (
    !rawTime ||
    !Number.isFinite(Date.parse(rawTime)) ||
    entry.createdAt === null ||
    Date.parse(rawTime) !== Date.parse(entry.createdAt)
  )
    return null;
  diagnostic.failedStep = 'answer-author';
  let authorPresent = false;
  for (const link of await row.locator('a[href]').all()) {
    const path = await link.getAttribute('href', { timeout: 150 });
    const name = path
      ? /^\/([A-Za-z0-9_.]{1,30})\/$/.exec(path)?.[1]
      : undefined;
    if (
      name &&
      normalize(name).toLowerCase() === normalize(entry.account).toLowerCase()
    )
      authorPresent = true;
  }
  if (!authorPresent) return null;
  diagnostic.failedStep = 'answer-text';
  if (
    entry.text &&
    !normalize(await row.innerText({ timeout: 150 })).includes(
      normalize(entry.text),
    )
  )
    return null;
  diagnostic.failedStep = 'none';
  diagnostic.extraction = 'answer';
  return {
    username: entry.account,
    text: normalize(entry.text),
    rawText: entry.text,
    links,
    answerEntry: entry,
  };
}

/** Reply-only fallback. The focal reader and its exact legacy block stay intact. */
export async function readReplyRow(
  row: Locator,
  diagnostic: ReplyRowDiagnostic,
  allowAdjacent: boolean,
) {
  diagnostic.failedStep = 'author';
  const blocks = row.locator(':scope > div:not([role])');
  if ((await blocks.count()) === 1) {
    const legacy = await textBlock(blocks, 150);
    if (legacy) {
      diagnostic.extraction = 'legacy';
      diagnostic.failedStep = 'text';
      const raw = await blocks
        .locator(':scope > div')
        .nth(1)
        .locator(':scope > span[dir="auto"]')
        .innerText({ timeout: 150 });
      diagnostic.failedStep = 'none';
      return {
        ...legacy,
        answerEntry: undefined,
        rawText: raw.normalize('NFC').trim(),
        links: blocks.locator('a[href*="/c/"]'),
      };
    }
  }
  diagnostic.failedStep = 'author';
  if (!allowAdjacent) return null;
  const profiles: Locator[] = [];
  for (const link of await row.locator('a[href]').all()) {
    const href = await link.getAttribute('href', { timeout: 150 });
    if (href && /^\/[A-Za-z0-9_.]{1,30}\/$/.test(href)) profiles.push(link);
  }
  if (profiles.length !== 1) return null;
  const profile = profiles[0]!,
    href = (await profile.getAttribute('href', { timeout: 150 }))!;
  const username = href.slice(1, -1);
  if (
    normalize(await profile.innerText({ timeout: 150 })) !== username ||
    (await profile.locator('img').count()) !== 0
  )
    return null;
  diagnostic.failedStep = 'text';
  const span = profile.locator(
    'xpath=following-sibling::*[1][self::span[@dir="auto"]]',
  );
  if (
    (await span.count()) !== 1 ||
    (await span
      .locator('xpath=ancestor::a | ancestor::span[@dir="auto"]')
      .count()) !== 0 ||
    (await profile
      .locator('xpath=..')
      .locator(':scope > span[dir="auto"]')
      .count()) !== 1 ||
    (await span
      .locator('time,button,img,[role="button"],a[href*="/c/"]')
      .count()) !== 0
  )
    return null;
  const rawText = (await span.innerText({ timeout: 150 }))
    .normalize('NFC')
    .trim();
  if (!rawText) return null;
  diagnostic.failedStep = 'none';
  diagnostic.extraction = 'adjacent';
  return {
    username,
    answerEntry: undefined,
    text: normalize(rawText),
    rawText,
    links: row.locator('a[href*="/c/"]'),
  };
}
