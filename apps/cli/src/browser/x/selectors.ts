import type { Locator, Page } from 'playwright-core';
import { CliError } from '../../cli/errors.ts';
import type { PlatformCheckReason } from '../../cli/errors.ts';

async function one(
  locator: Locator,
  reason?: PlatformCheckReason,
): Promise<Locator> {
  if ((await locator.count()) !== 1)
    throw new CliError(
      'PLATFORM_CHECK',
      undefined,
      undefined,
      reason ?? 'count',
    );
  if (!(await locator.isVisible()))
    throw new CliError('PLATFORM_CHECK', undefined, undefined, 'hidden');
  return locator;
}
async function button(
  page: Page | Locator,
  attribute: string,
  names: RegExp,
): Promise<Locator> {
  const stable = page.getByTestId(attribute);
  return one(
    (await stable.count())
      ? stable
      : page.getByRole('button', { name: names, exact: true }),
  );
}
export const xSelectors = {
  async rendered(
    page: Page,
    ready: Locator,
    timeoutMs = 20_000,
  ): Promise<void> {
    const markers = page.locator(
      '[data-testid="loginButton"], [data-testid="challenge"], [data-testid="lockedAccount"], [data-testid="rateLimit"]',
    );
    const notices = page.getByText(
      /^(Log in to X|Sign in to X|Bei X anmelden|Verify your identity|Confirm you are human|Bestätige deine Identität|Your account is locked|Dein Account wurde gesperrt|Rate limit exceeded|Du hast dein Limit erreicht)$/,
    );
    try {
      await ready
        .or(markers)
        .or(notices)
        .and(page.locator(':visible'))
        .first()
        .waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      throw new CliError(
        'PLATFORM_CHECK',
        undefined,
        undefined,
        'render-timeout',
      );
    }
    await this.check(page);
  },
  async check(page: Page): Promise<void> {
    for (const [testId, reason] of [
      ['loginButton', 'marker-login'],
      ['challenge', 'marker-challenge'],
      ['lockedAccount', 'marker-locked'],
      ['rateLimit', 'marker-rate-limit'],
    ] as const)
      if (await page.getByTestId(testId).count())
        throw new CliError('PLATFORM_CHECK', undefined, undefined, reason);
    const notice = page.getByText(
      /^(Log in to X|Sign in to X|Bei X anmelden|Verify your identity|Confirm you are human|Bestätige deine Identität|Your account is locked|Dein Account wurde gesperrt|Rate limit exceeded|Du hast dein Limit erreicht)$/,
    );
    if (await notice.count())
      throw new CliError('PLATFORM_CHECK', undefined, undefined, 'notice-text');
  },
  async account(page: Page, timeoutMs = 20_000): Promise<string> {
    await this.rendered(
      page,
      page.getByTestId('SideNav_AccountSwitcher_Button'),
      timeoutMs,
    );
    const switcher = await one(
      page.getByTestId('SideNav_AccountSwitcher_Button'),
    );
    const handles = (await switcher.innerText()).match(
      /@[A-Za-z0-9_]{1,50}\b/g,
    );
    if (!handles || handles.length !== 1)
      throw new CliError(
        'PLATFORM_CHECK',
        undefined,
        undefined,
        'account-handle',
      );
    return handles[0].slice(1);
  },
  async state(
    page: Page,
    id: string,
    timeoutMs = 20_000,
  ): Promise<'present' | 'gone'> {
    await this.rendered(
      page,
      this.focalLocator(page, id).or(page.getByTestId('error-detail')),
      timeoutMs,
    );
    const missing = page.getByTestId('error-detail');
    const notFound = page.getByText(
      /^(This Post was deleted by the Post author\.?|This Post doesn’t exist\.?|This Post doesn't exist\.?|Dieser Post wurde vom Autor gelöscht\.?|Dieser Post existiert nicht\.?)$/,
    );
    if ((await missing.count()) === 1 && (await notFound.count()) === 1)
      return 'gone';
    const post = await this.focal(page, id);
    const timestamp = post
      .locator(`a[href$="/status/${id}"]`)
      .filter({ has: page.locator('time') });
    await one(timestamp, 'focal-time');
    return 'present';
  },
  focalLocator(page: Page, id: string): Locator {
    if (!/^\d{1,40}$/.test(id))
      throw new CliError('PLATFORM_CHECK', undefined, undefined, 'bad-id');
    return page.locator('article[data-testid="tweet"]').filter({
      has: page
        .locator(`a[href$="/status/${id}"]`)
        .filter({ has: page.locator('time') }),
    });
  },
  async focal(page: Page, id: string): Promise<Locator> {
    const post = await one(this.focalLocator(page, id), 'focal-count');
    await one(
      post
        .locator(`a[href$="/status/${id}"]`)
        .filter({ has: page.locator('time') }),
      'focal-time',
    );
    return post;
  },
  async more(page: Page, id: string) {
    await this.check(page);
    return button(await this.focal(page, id), 'caret', /^(More|Mehr)$/);
  },
  async deleteMenu(page: Page) {
    await this.check(page);
    const stable = page.getByTestId('delete');
    return one(
      (await stable.count())
        ? stable
        : page.getByRole('menuitem', {
            name: /^(Delete|Löschen)$/,
            exact: true,
          }),
    );
  },
  async confirm(page: Page) {
    await this.check(page);
    return button(page, 'confirmationSheetConfirm', /^(Delete|Löschen)$/);
  },
  async repost(page: Page, id: string) {
    await this.check(page);
    return button(
      await this.focal(page, id),
      'unretweet',
      /^(Repost|Reposted|Repostet)$/,
    );
  },
  async undoRepost(page: Page) {
    await this.check(page);
    const stable = page.getByTestId('unretweetConfirm');
    return one(
      (await stable.count())
        ? stable
        : page.getByRole('menuitem', {
            name: /^(Undo repost|Repost rückgängig machen)$/,
            exact: true,
          }),
    );
  },
  async confirmation(
    page: Page,
    action: 'delete-post' | 'undo-repost',
  ): Promise<boolean> {
    await this.check(page);
    const toast = page.getByTestId('toast');
    const text =
      action === 'delete-post'
        ? /^(Your post was deleted|Dein Post wurde gelöscht)\.?$/
        : /^(Your repost was undone|Dein Repost wurde rückgängig gemacht)\.?$/;
    return (
      (await toast.count()) === 1 && text.test((await toast.innerText()).trim())
    );
  },
};
