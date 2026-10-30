import type { Page } from 'playwright-core';
import { InstagramRepliesSchema } from '@socialprune/core';
import type { InstagramContext } from '@socialprune/core';
import { checkPage, textBlock, postAddress } from './selectors.ts';
import { answerLikes, parseVisibleLikes } from './likes.ts';
import { normalize } from './plan.ts';
import { ContextStop } from './report.ts';
import { CliError } from '../../cli/errors.ts';
import { checkedReplyRows } from './replies-answer.ts';

export const REPLY_REASONS = [
  'reply-window-empty',
  'reply-window-incomplete',
  'reply-controls-changed',
  'reply-scope-unverified',
  'reply-answer-incomplete',
  'reply-answer-conflict',
  'reply-answer-mismatch',
  'reply-read-failed',
] as const;
export type ReplyReason = (typeof REPLY_REASONS)[number];
export class ReplyReadFailure extends Error {
  readonly reason: ReplyReason;
  constructor(reason: ReplyReason) {
    super(reason);
    this.reason = reason;
  }
}

export const REPLY_CAP = 50;

// Main-mode capture has its own failure boundary; platform guards stay outside it.
export async function captureRepliesForMode<T>(
  read: () => Promise<T>,
  refresh: boolean,
  capture: boolean,
  failed: (reason: ReplyReason) => void,
): Promise<T | undefined> {
  if (!refresh && !capture) return undefined;
  try {
    return await read();
  } catch (error) {
    // Notice, account, language, network and cancellation guards retain their stops.
    if (
      error instanceof CliError &&
      !(
        error instanceof ContextStop &&
        ['post-structure', 'comment-structure'].includes(error.token)
      )
    )
      throw error;
    failed(
      error instanceof ReplyReadFailure ? error.reason : 'reply-read-failed',
    );
    if (refresh) throw error;
    return undefined;
  }
}

/** Only the confirmed comment's own reply group, never a page-wide reply control. */
export async function commentReplies(
  page: Page,
  bodies: readonly unknown[],
  match: { id: string; createdAt: string; username: string; text: string },
  guard: () => void,
  deadline: number,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  expandMs = 3000,
  verified: (answerChecked: boolean) => void = () => {},
  flush: () => Promise<void> = async () => {},
): Promise<NonNullable<InstagramContext['replies']>> {
  const entries: (NonNullable<
    InstagramContext['replies']
  >['entries'][number] & { id?: string })[] = [];
  const seen = new Set<string>();
  let moreCount = 0,
    capped = false,
    clicks = 0;
  let beforeExpansion: number | undefined;
  const address =
    postAddress(page.url(), new URL(page.url()).origin, match.id) ??
    postAddress(page.url(), new URL(page.url()).origin);
  if (!address) throw new ReplyReadFailure('reply-scope-unverified');
  guard();
  await checkPage(page);
  const focal = page.locator(
    `main a[href="/${address.kind}/${address.code}/c/${match.id}/"]`,
  );
  const focalTimes = focal.locator('time[datetime]');
  const rawFocalTime =
    (await focalTimes.count()) === 1
      ? await focalTimes.getAttribute('datetime', { timeout: 150 })
      : null;
  if (
    (await focal.count()) !== 1 ||
    !rawFocalTime ||
    Date.parse(rawFocalTime) !== Date.parse(match.createdAt)
  )
    throw new ReplyReadFailure('reply-scope-unverified');
  const content = await textBlock(focal.locator('xpath=ancestor::*[3]'), 150);
  if (
    !content ||
    content.username.toLowerCase() !== match.username.toLowerCase() ||
    normalize(content.text) !== normalize(match.text)
  )
    throw new ReplyReadFailure('reply-scope-unverified');
  const root = focal.locator('xpath=ancestor::*[5]');
  if (
    (await root.count()) !== 1 ||
    (await root.locator('xpath=ancestor::main').count()) !== 1 ||
    (await root
      .locator(`a[href="/${address.kind}/${address.code}/c/${match.id}/"]`)
      .count()) !== 1
  )
    throw new ReplyReadFailure('reply-scope-unverified');
  const outer = root.locator('xpath=ancestor::*[2]');
  const avatars = outer.locator(':scope > a');
  if (
    (await root.locator('xpath=parent::div').locator(':scope > *').count()) !==
      1 ||
    (await avatars.count()) !== 1 ||
    (await avatars.getAttribute('href', { timeout: 150 }))?.toLowerCase() !==
      `/${match.username.toLowerCase()}/` ||
    (await outer.locator(':scope > div').count()) !== 1
  )
    throw new ReplyReadFailure('reply-scope-unverified');
  for (;;) {
    guard();
    await checkPage(page);
    const current =
      postAddress(page.url(), new URL(page.url()).origin, match.id) ??
      postAddress(page.url(), new URL(page.url()).origin);
    if (current?.code !== address.code || current.kind !== address.kind)
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    const rows = root.locator(':scope > ul > li, :scope > div > ul > li');
    const count = await rows.count();
    if (
      (await root.locator('a[href*="/c/"]').count()) -
        (await rows.locator('a[href*="/c/"]').count()) !==
        1 ||
      (await root.locator(':scope > ul, :scope > div > ul').count()) > 1
    )
      throw new ReplyReadFailure('reply-scope-unverified');
    for (let index = 0; index < Math.min(count, REPLY_CAP); index++) {
      if (performance.now() >= deadline) {
        throw new ReplyReadFailure(
          entries.length ? 'reply-window-incomplete' : 'reply-window-empty',
        );
      }
      const row = rows.nth(index);
      if (!(await row.isVisible())) continue;
      const blocks = row.locator(':scope > div:not([role])');
      if ((await blocks.count()) !== 1)
        throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'comment-structure');
      const value = await textBlock(blocks, 150);
      if (!value)
        throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'comment-structure');
      const links = blocks.locator('a[href*="/c/"]');
      const href =
        (await links.count()) === 1
          ? await links.getAttribute('href', { timeout: 150 })
          : null;
      const id = href
        ? new RegExp(
            `^/${address.kind}/${address.code}/c/([0-9]{1,40})/$`,
          ).exec(href)?.[1]
        : undefined;
      const time = links.locator('time[datetime]');
      const rawTime =
        (await time.count()) === 1
          ? await time.getAttribute('datetime', { timeout: 150 })
          : null;
      const createdAt =
        id && rawTime && Number.isFinite(Date.parse(rawTime))
          ? new Date(rawTime).toISOString()
          : null;
      const key =
        id ?? JSON.stringify([value.username, value.text, createdAt, index]);
      if (seen.has(key)) continue;
      seen.add(key);
      const answer =
        id && createdAt
          ? answerLikes(bodies, { ...value, id, createdAt })
          : null;
      const likes = [];
      for (const node of await row
        .locator(':scope > button, :scope > [role="button"]')
        .all()) {
        const count = parseVisibleLikes(
          normalize(await node.innerText({ timeout: 150 })),
        );
        if (count !== null && (await node.isVisible())) likes.push(count);
      }
      entries.push({
        ...(id ? { id } : {}),
        account: value.username,
        text: (
          await blocks
            .locator(':scope > div')
            .nth(1)
            .locator(':scope > span[dir="auto"]')
            .innerText({ timeout: 150 })
        )
          .normalize('NFC')
          .trim(),
        createdAt,
        likes:
          answer !== null
            ? { count: answer, source: 'answer' }
            : likes.length === 1
              ? { count: likes[0]!, source: 'dom' }
              : { count: null, source: null },
      });
      if (entries.length === REPLY_CAP) break;
    }
    const control = root
      .locator(
        ':scope > button, :scope > div > button, :scope > div > [role="button"], :scope > [role="button"]',
      )
      .filter({ hasText: /^View replies$/u });
    const controls = await control.count();
    const replyControls = await root
      .locator(
        ':scope > button, :scope > div > button, :scope > div > [role="button"], :scope > [role="button"]',
      )
      .filter({ hasText: /^(?:View|Hide|See|Load).*repl/iu })
      .count();
    if (controls > 1 || replyControls !== controls)
      throw new ReplyReadFailure('reply-controls-changed');
    if (
      beforeExpansion !== undefined &&
      entries.length === beforeExpansion &&
      controls === 0
    )
      throw new ReplyReadFailure('reply-controls-changed');
    moreCount = Math.max(0, count - entries.length, controls ? 1 : 0);
    if (entries.length >= REPLY_CAP || clicks >= 10) {
      capped = true;
      break;
    }
    if (performance.now() >= deadline)
      throw new ReplyReadFailure(
        entries.length ? 'reply-window-incomplete' : 'reply-window-empty',
      );
    if (!controls) break;
    if (controls !== 1 || !(await control.isVisible()))
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    if (performance.now() + expandMs >= deadline) {
      throw new ReplyReadFailure(
        entries.length ? 'reply-window-incomplete' : 'reply-window-empty',
      );
    }
    await pause(expandMs);
    guard();
    await checkPage(page);
    beforeExpansion = entries.length;
    try {
      await control.click({
        timeout: Math.max(1, Math.min(1000, deadline - performance.now())),
      });
    } catch (error) {
      guard();
      await checkPage(page);
      if (
        error instanceof Error &&
        error.name === 'TimeoutError' &&
        performance.now() >= deadline
      ) {
        throw new ReplyReadFailure(
          entries.length ? 'reply-window-incomplete' : 'reply-window-empty',
        );
      }
      throw error;
    }
    clicks++;
    guard();
    await checkPage(page);
    // Allow the scoped read response/render to expose rows before re-reading
    // its replacement control. The existing step deadline remains the bound.
    const previousCount = count;
    while (
      performance.now() < deadline &&
      (await rows.count()) === previousCount &&
      (await control.count()) === controls
    ) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(100, Math.max(1, deadline - performance.now())),
        ),
      );
      guard();
      await checkPage(page);
    }
  }
  await flush();
  guard();
  await checkPage(page);
  const checked = checkedReplyRows(bodies, match, entries, capped, moreCount);
  if (checked.reason) throw new ReplyReadFailure(checked.reason);
  verified(checked.answerChecked);
  return InstagramRepliesSchema.parse(checked.observation);
}
