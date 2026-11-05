import type { Page } from 'playwright-core';
import { InstagramRepliesSchema } from '@socialprune/core';
import type { InstagramContext } from '@socialprune/core';
import { checkPage, textBlock, postAddress } from './selectors.ts';
import { answerLikes, parseVisibleLikes } from './likes.ts';
import { normalize } from './plan.ts';
import { ContextStop } from './report.ts';
import type { ReplyScopeDiagnostic } from './report.ts';
import { CliError } from '../../cli/errors.ts';
import {
  answerReplies,
  checkedReplyRows,
  replyAnswerDiagnostic,
} from './replies-answer.ts';
import type { ReplyAnswerDiagnostic } from './report.ts';
import type { PostPathClass } from './signals.ts';
import {
  structuralReplyScope,
  REPLY_ROWS,
  ownReplyControls,
} from './replies-scope.ts';

export const REPLY_REASONS = [
  'reply-window-empty',
  'reply-window-incomplete',
  'reply-controls-changed',
  'reply-scope-unverified',
  'reply-answer-incomplete',
  'reply-answer-absent',
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
    if (refresh) {
      if (error instanceof ReplyReadFailure)
        throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', error.reason);
      throw error;
    }
    return undefined;
  }
}

type ReplyMatch = {
  id: string;
  createdAt: string;
  username: string;
  text: string;
  exportCreatedAt?: string;
};
export function emptyReplyScope(): ReplyScopeDiagnostic {
  return {
    observed: false,
    failedCheck: 'none',
    addressResolved: false,
    addressWithMatchId: false,
    pageUrlMatchIdPresent: false,
    focalCount: null,
    focalTimeCount: null,
    nearbyTimeCount: null,
    focalTimePresent: null,
    focalTimeExact: null,
    focalTimeWithinExportTolerance: null,
    contentObserved: null,
    authorMatches: null,
    textMatches: null,
    rootCount: null,
    rootMainCount: null,
    rootFocalCount: null,
    avatarCount: null,
    avatarMatches: null,
    parentChildrenCount: null,
    outerDivCount: null,
    avatarObserved: false,
    chosenDepth: null,
    levels: [],
  };
}
async function checkedScope(
  page: Page,
  match: ReplyMatch,
  guard: () => void,
  diagnostic?: (value: ReplyScopeDiagnostic) => void,
  bodies: readonly unknown[] = [],
) {
  const shape = emptyReplyScope();
  const fail = (part: ReplyScopeDiagnostic['failedCheck']): never => {
    shape.observed = true;
    shape.failedCheck = part;
    diagnostic?.({ ...shape });
    throw new ReplyReadFailure('reply-scope-unverified');
  };
  const exact = postAddress(page.url(), new URL(page.url()).origin, match.id);
  const address = exact ?? postAddress(page.url(), new URL(page.url()).origin);
  shape.addressResolved = address !== null;
  shape.addressWithMatchId = exact !== null;
  shape.pageUrlMatchIdPresent = new URL(page.url()).pathname.endsWith(
    `/c/${match.id}/`,
  );
  if (!address) return fail('address');
  guard();
  await checkPage(page);
  const focalSelector = `a[href="/${address.kind}/${address.code}/c/${match.id}/"]`;
  const focal = page.locator(`main ${focalSelector}`);
  const focalTimes = focal.locator('time[datetime]');
  shape.focalCount = await focal.count();
  if (shape.focalCount !== 1) fail('focal-count');
  shape.focalTimeCount = await focalTimes.count();
  if (diagnostic)
    shape.nearbyTimeCount = await focal
      .locator('xpath=ancestor::*[3]')
      .locator('time[datetime]')
      .count();
  const rawFocalTime =
    shape.focalTimeCount === 1
      ? await focalTimes.getAttribute('datetime', { timeout: 150 })
      : null;
  shape.focalTimePresent = Boolean(rawFocalTime);
  if (!rawFocalTime) fail('focal-time');
  shape.focalTimeExact =
    Date.parse(rawFocalTime!) === Date.parse(match.createdAt);
  shape.focalTimeWithinExportTolerance =
    Math.abs(
      Date.parse(rawFocalTime!) -
        Date.parse(match.exportCreatedAt ?? match.createdAt),
    ) <= 60000;
  if (!shape.focalTimeExact) fail('focal-time-match');
  const content = await textBlock(focal.locator('xpath=ancestor::*[3]'), 150);
  shape.contentObserved = Boolean(content);
  shape.authorMatches = content
    ? content.username.toLowerCase() === match.username.toLowerCase()
    : null;
  shape.textMatches = content
    ? normalize(content.text) === normalize(match.text)
    : null;
  if (!content || !shape.authorMatches || !shape.textMatches)
    fail('author-text');
  const answer = answerReplies(bodies, match);
  const root = await structuralReplyScope(
    focal,
    focalSelector,
    answer.present && answer.valid && answer.total === 0,
    shape,
    guard,
  );
  if (!root) return fail('scope-depth');
  shape.observed = true;
  diagnostic?.({ ...shape });
  return { address, root, shape };
}
export async function replyScopeDiagnostic(
  page: Page,
  match: ReplyMatch,
  guard: () => void,
  bodies: readonly unknown[] = [],
) {
  let result = emptyReplyScope();
  try {
    await checkedScope(
      page,
      match,
      guard,
      (value) => {
        result = value;
      },
      bodies,
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (!(error instanceof ReplyReadFailure)) {
      guard();
      await checkPage(page);
      result.observed = false;
    }
  }
  return result;
}
/** Only the confirmed comment's own reply group, never a page-wide reply control. */
export async function commentReplies(
  page: Page,
  bodies: readonly unknown[],
  match: ReplyMatch,
  guard: () => void,
  deadline: number,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  expandMs = 3000,
  verified: (answerChecked: boolean) => void = () => {},
  flush: () => Promise<void> = async () => {},
  diagnostic?: (value: ReplyScopeDiagnostic) => void,
  answerDiagnostic?: (value: ReplyAnswerDiagnostic) => void,
  answerPaths: () => readonly PostPathClass[] = () => [],
  htmlDiagnostic: () => ReplyAnswerDiagnostic['html'] = () => ({
    documents: 0,
    jsonScripts: 0,
    matchIdDocuments: 0,
    observationFailed: false,
  }),
): Promise<NonNullable<InstagramContext['replies']>> {
  const entries: (NonNullable<
    InstagramContext['replies']
  >['entries'][number] & { id?: string })[] = [];
  const seen = new Set<string>();
  let moreCount = 0,
    capped = false,
    clicks = 0,
    beforeExpansion: number | undefined;
  if (performance.now() >= deadline)
    throw new ReplyReadFailure('reply-window-empty');
  await flush();
  guard();
  answerDiagnostic?.(
    replyAnswerDiagnostic(bodies, match, 0, answerPaths(), htmlDiagnostic()),
  );
  const { address, root, shape } = await checkedScope(
    page,
    match,
    guard,
    diagnostic,
    bodies,
  );
  for (;;) {
    guard();
    await checkPage(page);
    const current =
      postAddress(page.url(), new URL(page.url()).origin, match.id) ??
      postAddress(page.url(), new URL(page.url()).origin);
    if (current?.code !== address.code || current.kind !== address.kind)
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    const rows = root.locator(REPLY_ROWS);
    const count = await rows.count();
    if (
      (await root.locator('a[href*="/c/"]').count()) -
        (await rows.locator('a[href*="/c/"]').count()) !==
        1 ||
      (await root.locator(':scope > ul, :scope > div > ul').count()) > 1
    ) {
      diagnostic?.({ ...shape, failedCheck: 'reply-group' });
      throw new ReplyReadFailure('reply-scope-unverified');
    }
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
    const scopedControls = await ownReplyControls(root);
    const control = scopedControls.filter({ hasText: /^View replies$/u });
    const controls = await control.count();
    const replyControls = await scopedControls.count();
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
  answerDiagnostic?.(
    replyAnswerDiagnostic(
      bodies,
      match,
      entries.length,
      answerPaths(),
      htmlDiagnostic(),
    ),
  );
  if (checked.reason) throw new ReplyReadFailure(checked.reason);
  verified(checked.answerChecked);
  return InstagramRepliesSchema.parse(checked.observation);
}
