import type { Page, Locator } from 'playwright-core';
import { CliError } from '../../cli/errors.ts';
import type { InstagramDeleteRow } from './delete-plan.ts';
import {
  checkPage,
  outsideProfilePaths,
  readPost,
  confirmComment,
  postElement,
  scrollPostComments,
  clickAllowed,
  instagramNoticeContainers,
} from './selectors.ts';
import { ownerName } from './plan.ts';
export class InstagramDeleteStop extends CliError {
  readonly detail: 'limit-notice' | 'delete-error' | 'receipt-unconfirmed';
  constructor(detail: InstagramDeleteStop['detail']) {
    super('PLATFORM_CHECK');
    this.detail = detail;
  }
}

export async function checkInstagramDeletePage(
  page: Page,
  handle: string,
): Promise<void> {
  // Match notice headings as well as longer paragraphs, never dismiss them.
  for (const marker of [
    'Action Blocked',
    'Try again later',
    'We restrict certain activity',
    'Your account has been suspended',
    'Your account has been locked',
  ])
    if (
      await instagramNoticeContainers(page)
        .getByText(marker, { exact: false })
        .count()
    )
      throw new InstagramDeleteStop('limit-notice');
  if (
    await instagramNoticeContainers(page)
      .getByText('Try deleting it again', { exact: false })
      .count()
  )
    throw new InstagramDeleteStop('delete-error');
  await checkPage(page);
  const paths = await outsideProfilePaths(page);
  if (!paths.some((path) => path.toLowerCase() === `/${handle.toLowerCase()}/`))
    throw new CliError('ACCOUNT_MISMATCH');
}
export async function instagramDeleteIdentity(
  page: Page,
  row: InstagramDeleteRow,
  handle: string,
  origin: string,
): Promise<Locator> {
  await checkInstagramDeletePage(page, handle);
  const saved = row.context,
    post = await readPost(page, origin, saved.comment.id);
  const confirmed = confirmComment(post, row.item, handle);
  if (
    saved.confirmedBy !== 'post' ||
    saved.ownerCheck !== 'matched-export' ||
    post.kind !== saved.post.kind ||
    post.code !== saved.post.code ||
    post.ownerCount !== 1 ||
    !post.ownerMatchesProfile ||
    ownerName(post.owner) !== ownerName(saved.post.owner) ||
    ownerName(post.owner) !== ownerName(row.item.reference.ownerHandle ?? '') ||
    confirmed.state !== 'confirmed' ||
    confirmed.comment.id !== saved.comment.id ||
    confirmed.comment.createdAt !== saved.comment.createdAt
  )
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  const link = post.element.locator(
    `a[href="/${saved.post.kind}/${saved.post.code}/c/${saved.comment.id}/"]`,
  );
  if ((await link.count()) !== 1) throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  return link.locator('xpath=ancestor::*[3]');
}
export async function clickInstagramDelete(
  page: Page,
  row: InstagramDeleteRow,
  handle: string,
  origin: string,
  beforeFinal: () => Promise<void>,
): Promise<void> {
  let block = await instagramDeleteIdentity(page, row, handle, origin);
  if (await page.getByRole('dialog').count())
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  await block.hover();
  block = await instagramDeleteIdentity(page, row, handle, origin);
  const parent = block.locator('xpath=parent::*');
  if ((await parent.locator('a[href*="/c/"]').count()) !== 1)
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  const options = parent.getByRole('button', { name: 'Options', exact: true });
  if ((await options.count()) !== 1 || !(await options.isVisible()))
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  await options.click();
  await instagramDeleteIdentity(page, row, handle, origin);
  const dialog = page.getByRole('dialog');
  const button = dialog.getByRole('button', { name: 'Delete', exact: true });
  if (
    (await dialog.count()) !== 1 ||
    (await button.count()) !== 1 ||
    !(await button.isVisible())
  )
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  await beforeFinal();
  await instagramDeleteIdentity(page, row, handle, origin);
  if (
    await page
      .getByRole('status')
      .filter({ hasText: /^Comment deleted\.?$/ })
      .count()
  )
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  if (
    (await dialog.count()) !== 1 ||
    (await button.count()) !== 1 ||
    !(await button.isVisible())
  )
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  await button.click();
}
export async function instagramDeleteUiConfirmed(page: Page): Promise<boolean> {
  // A positive UI status, not a disappearance or a counter change. Its real
  // markup remains a watched-canary proof obligation, not a generic fallback.
  const status = page
    .getByRole('status')
    .filter({ hasText: /^Comment deleted\.?$/ });
  return (await status.count()) === 1 && (await status.isVisible());
}

/** A bounded page read cannot prove absence. It either finds this exact
 * comment, or leaves its effect unverified without clearing a resend block. */
export async function verifyInstagramComment(
  page: Page,
  row: InstagramDeleteRow,
  handle: string,
  origin: string,
): Promise<'present' | 'unverified'> {
  await checkInstagramDeletePage(page, handle);
  const saved = row.context,
    post = await readPost(page, origin, saved.comment.id);
  if (
    post.kind !== saved.post.kind ||
    post.code !== saved.post.code ||
    post.ownerCount !== 1 ||
    !post.ownerMatchesProfile ||
    ownerName(post.owner) !== ownerName(saved.post.owner) ||
    ownerName(post.owner) !== ownerName(row.item.reference.ownerHandle ?? '')
  )
    throw new CliError('INSTAGRAM_SHAPE_CHANGED');
  const matchingId = post.comments.filter((c) => c.id === saved.comment.id);
  if (matchingId.length === 0) return 'unverified';
  await instagramDeleteIdentity(page, row, handle, origin);
  return 'present';
}

export async function expandInstagramDeleteComment(
  page: Page,
  row: InstagramDeleteRow,
  handle: string,
  origin: string,
  check: () => Promise<void>,
): Promise<void> {
  for (let step = 0; step < 10; step++) {
    await check();
    await checkInstagramDeletePage(page, handle);
    const post = await readPost(page, origin, row.context.comment.id);
    if (post.comments.some((comment) => comment.id === row.context.comment.id))
      return;
    if (
      post.code !== row.context.post.code ||
      post.kind !== row.context.post.kind ||
      post.ownerCount !== 1 ||
      ownerName(post.owner) !== ownerName(row.context.post.owner)
    )
      throw new CliError('INSTAGRAM_SHAPE_CHANGED');
    const element = await postElement(page, origin, row.context.comment.id);
    if (!element) throw new CliError('INSTAGRAM_SHAPE_CHANGED');
    let expanded = false;
    for (const name of ['Load more comments', 'View replies'] as const) {
      const button = element.getByRole('button', { name, exact: true });
      if ((await button.count()) > 1)
        throw new CliError('INSTAGRAM_SHAPE_CHANGED');
      if ((await button.count()) === 1 && (await button.isVisible())) {
        await check();
        await clickAllowed(page, { kind: 'named', name }, () => {});
        expanded = true;
        break;
      }
    }
    if (!expanded)
      expanded = await scrollPostComments(
        page,
        origin,
        () => {},
        row.context.comment.id,
      );
    if (!expanded) return;
    await page.waitForTimeout(500);
  }
}
