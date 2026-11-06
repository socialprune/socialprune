import { setTimeout as sleep } from 'node:timers/promises';
import type { Locator, Page } from 'playwright-core';
import { matchedReplyRows } from './replies-scope.ts';
import { checkPage } from './selectors.ts';
import type { ReplyExpansionDiagnostic } from './report.ts';
type Address = { kind: 'p' | 'reel'; code: string };
type Poll = NonNullable<ReplyExpansionDiagnostic['clicks'][number]['poll']>;
const MAX_POLL_MS = 5000;

/** Immediate new sibling group only. Never walk past another element/thread. */
export async function siblingReplyRows(root: Locator, address: Address) {
  let rows = root.locator('xpath=./*[false()]');
  const siblings = root.locator('xpath=following-sibling::*');
  for (const node of (await siblings.all()).slice(0, 50)) {
    if ((await node.locator('xpath=self::ul').count()) === 1) {
      for (const row of await node.locator(':scope > li').all())
        rows = rows.or(row);
      break;
    }
    if ((await node.locator('xpath=self::li').count()) !== 1) break;
    rows = rows.or(node);
  }
  let qualified = root.locator('xpath=./*[false()]');
  for (const row of await rows.all()) {
    const links = row.locator('a[href*="/c/"]'),
      times = row.locator('time[datetime]');
    if (
      (await links.count()) !== 1 ||
      (await times.count()) !== 1 ||
      (await links.locator('time[datetime]').count()) !== 1
    )
      continue;
    const href = await links.getAttribute('href', { timeout: 150 }),
      time = await times.getAttribute('datetime', { timeout: 150 });
    if (
      href &&
      new RegExp(`^/${address.kind}/${address.code}/c/[0-9]{1,40}/$`).test(
        href,
      ) &&
      time &&
      Number.isFinite(Date.parse(time))
    )
      qualified = qualified.or(row);
  }
  return qualified;
}
export async function neighborhood(
  page: Page,
  root: Locator,
  address: Address,
  focal: string,
): Promise<Poll['after']> {
  const parent = root.locator('xpath=..'),
    siblings = root.locator('xpath=following-sibling::*[position() <= 50]');
  const main = page.locator('main');
  const samePost = `a[href^="/${address.kind}/${address.code}/c/"]:not([href="/${address.kind}/${address.code}/c/${focal}/"])`;
  const result: Poll['after'] = [];
  for (const [location, node] of [
    ['scope', root],
    ['parent', parent],
    ['next-sibling', siblings],
    ['elsewhere-in-main', main],
  ] as const) {
    const inclusive = (selector: string, self: string) =>
      node
        .locator(`${selector}:visible`)
        .or(node.locator(`xpath=self::${self}`).filter({ visible: true }));
    result.push({
      location,
      li: await inclusive('li', 'li').count(),
      ul: await inclusive('ul', 'ul').count(),
      otherCommentPermalinks: await node.locator(`${samePost}:visible`).count(),
      datedTimes: await node.locator('time[datetime]:visible').count(),
      progressbars: await node.locator('[role="progressbar"]:visible').count(),
      loadingSvgs: await node
        .locator(
          'svg[aria-label="Loading" i]:visible,svg[aria-label="Loading..." i]:visible',
        )
        .count(),
    });
  }
  // Elsewhere excludes this scope/parent region, not a second reading target.
  const elsewhere = result[3]!,
    within = result[1]!;
  for (const key of [
    'li',
    'ul',
    'otherCommentPermalinks',
    'datedTimes',
    'progressbars',
    'loadingSvgs',
  ] as const)
    elsewhere[key] = Math.max(0, elsewhere[key] - within[key]);
  return result;
}
export async function pollReplyGrowth(
  page: Page,
  root: Locator,
  address: Address,
  focal: string,
  before: Poll['after'],
  deadline: number,
  guard: () => void,
  poll: Poll,
) {
  const started = performance.now(),
    end = Math.min(deadline, started + MAX_POLL_MS);
  for (let sample = 0; sample < 51; sample++) {
    guard();
    await checkPage(page);
    try {
      poll.after = await neighborhood(page, root, address, focal);
      poll.samples++;
      const growth = poll.after.some(
        (value, index) =>
          value.otherCommentPermalinks >
          (before[index]?.otherCommentPermalinks ?? 0),
      );
      if (growth) {
        poll.firstGrowthMs = Math.min(
          MAX_POLL_MS,
          Math.round(performance.now() - started),
        );
        poll.timeout = false;
        break;
      }
    } catch {
      guard();
      await checkPage(page);
      poll.observationFailed = true;
      break;
    }
    if (performance.now() >= end) break;
    await sleep(Math.min(100, Math.max(1, end - performance.now())));
  }
  poll.elapsedMs = Math.min(
    MAX_POLL_MS,
    Math.round(performance.now() - started),
  );
}
export async function expandedRows(
  root: Locator,
  address: Address,
  siblingsAllowed: boolean,
) {
  const scoped = await matchedReplyRows(root, address);
  return siblingsAllowed
    ? scoped.or(await siblingReplyRows(root, address))
    : scoped;
}
