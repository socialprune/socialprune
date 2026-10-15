import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { WorkspaceClient } from '../../web/src/workspace/client.ts';
import {
  contextInputs,
  writeContextFixture,
} from '../src/review/test/context-fixture.ts';
import { startReviewServer } from '../src/review/server.ts';
import { reviewAssetDirectory } from '../src/review/static.ts';

const own = contextInputs.items[0]!;
type ReviewWindow = Window & { workspace: WorkspaceClient };
const foreignValues = [
  contextInputs.foreign.text,
  contextInputs.foreign.reference.ownerHandle!,
  contextInputs.codes[4]!,
];
function assertNoForeign(text: string) {
  for (const value of foreignValues) expect(text).not.toContain(value);
}

test('confirmed Instagram posts replace each local fallback, show files only on origin and never render another account context', async ({
  page,
  context,
}, info) => {
  test.setTimeout(90_000);
  const workspace = await mkdtemp(
    join(tmpdir(), 'socialprune-review-context-'),
  );
  // This screenshot contains only the generated fixture, not a platform page.
  await page.setContent('<!doctype html><p></p>');
  await page.locator('p').evaluate((node, text) => {
    node.textContent = text;
  }, own.text);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 60 });
  const fixture = await writeContextFixture(workspace, jpeg);
  const server = await startReviewServer({
    workspace,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
  });
  const origin = new URL(server.url).origin;
  const requests: string[] = [],
    errors: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(globalThis, '__contextViolations', []);
    document.addEventListener('securitypolicyviolation', (event) =>
      (Reflect.get(globalThis, '__contextViolations') as string[]).push(
        `${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber} ${event.sample}`,
      ),
    );
  });
  try {
    // LL-002: prove the forbidden-value assertion itself detects a planted leak.
    expect(() => assertNoForeign(foreignValues.join('\n'))).toThrow();
    await page.goto(server.launchUrl);
    await page
      .getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Review', exact: true })
      .click();
    const post = page.getByTestId('instagram-post');
    await expect(post).toHaveCount(1);
    await expect(post).toContainText('@' + fixture.records[0]!.post.owner);
    await expect(post.locator('time')).toHaveAttribute(
      'datetime',
      own.createdAt,
    );
    await expect(post.locator('[dir="auto"]')).toHaveText(
      fixture.records[0]!.post.caption!,
    );
    await expect(post).toContainText(
      'Instagram showed only the beginning of this caption.',
    );
    await expect(post).toContainText(
      "SocialPrune found this comment on the post in your signed-in Instagram on 15 October 2026. Its text, time and the post's account match your export.",
    );
    await expect(post.locator('img')).toHaveCount(1);
    await expect
      .poll(() =>
        post
          .locator('img')
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    expect(requests.some((url) => url.endsWith('/shot.jpg'))).toBe(false);
    const show = post.getByRole('button', {
      name: 'Show screenshot',
      exact: true,
    });
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await show.click();
    await expect(show).toHaveAttribute('aria-expanded', 'true');
    const shot = post.getByRole('img', {
      name: 'Screenshot of the post as Instagram showed it on 15 October 2026',
      exact: true,
    });
    await expect
      .poll(() =>
        shot.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const link = post.getByRole('link', {
      name: 'Open on Instagram',
      exact: true,
    });
    await expect(link).toHaveAttribute(
      'href',
      `https://www.instagram.com/p/${contextInputs.codes[0]}/`,
    );
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(context.pages()).toHaveLength(1);
    // Exercise the native new-tab click against this generated origin only.
    await link.evaluate(
      (node, href) => node.setAttribute('href', href),
      server.url,
    );
    const opened = context.waitForEvent('page');
    await link.click();
    const openedPage = await opened;
    await openedPage.waitForLoadState();
    expect(new URL(openedPage.url()).origin).toBe(origin);
    expect(await openedPage.evaluate(() => window.opener === null)).toBe(true);
    await openedPage.close();
    await link.evaluate(
      (node, href) => node.setAttribute('href', href),
      `https://www.instagram.com/p/${contextInputs.codes[0]}/`,
    );
    await expect(
      post.locator('[dir="auto"] img, [dir="auto"] script'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => Reflect.get(globalThis, 'contextExecuted') as unknown,
      ),
    ).toBeUndefined();
    assertNoForeign(await page.locator('main').innerText());
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (info.project.name === 'chromium')
      await page.screenshot({
        path: info.outputPath('instagram-context-320.png'),
        fullPage: true,
        caret: 'initial',
        animations: 'allow',
      });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByTestId('app-menu')
      .getByRole('combobox', { name: 'Language', exact: true })
      .selectOption('de');
    await page.keyboard.press('Escape');
    await expect(post).toContainText(
      'SocialPrune hat diesen Kommentar am 15. Oktober 2026 in deinem angemeldeten Instagram unter dem Beitrag gefunden. Text, Zeit und das Konto des Beitrags stimmen mit deinem Export überein.',
    );
    await expect(
      post.getByRole('button', { name: 'Screenshot zeigen', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    await page
      .getByTestId('app-menu')
      .getByRole('combobox', { name: 'Sprache', exact: true })
      .selectOption('en');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByTestId('app-menu')
      .getByRole('link', { name: 'List view', exact: true })
      .click();
    const grid = page.getByRole('grid');
    const ownRow = grid.getByRole('row').filter({ hasText: own.text });
    await expect(ownRow).toBeVisible();
    await ownRow.dblclick();
    await expect(post).toContainText(own.text);
    await expect(
      page.getByRole('region', { name: 'Entry details' }),
    ).not.toContainText(
      'The post this comment is on is not part of your export.',
    );
    assertNoForeign(
      await page.getByRole('region', { name: 'Entry details' }).innerText(),
    );
    await page.evaluate(() => {
      location.hash = '#/archive';
    });
    await expect(page.getByTestId('archive')).toBeVisible();
    await expect(
      page
        .locator(`article[data-item-id="${own.id}"]`)
        .getByTestId('instagram-post'),
    ).toContainText(own.text);
    const notCaptured = page
      .locator(`article[data-item-id="${contextInputs.items[1]!.id}"]`)
      .getByTestId('instagram-post');
    await expect(notCaptured).toContainText(
      'SocialPrune did not keep the first image of this post.',
    );
    await expect(
      notCaptured.getByRole('link', { name: 'Open on Instagram' }),
    ).toHaveAttribute(
      'href',
      `https://www.instagram.com/reel/${contextInputs.codes[1]}/`,
    );
    const missing = page
      .locator(`article[data-item-id="${contextInputs.items[2]!.id}"]`)
      .getByTestId('instagram-post');
    await missing.scrollIntoViewIfNeeded();
    await expect(missing).toContainText('Not in this copy');
    await missing
      .getByRole('button', { name: 'Show screenshot', exact: true })
      .click();
    await expect(
      missing.getByText('Not in this copy', { exact: true }),
    ).toHaveCount(2);
    const noRecord = page.locator(
      `article[data-item-id="${contextInputs.items[3]!.id}"]`,
    );
    await expect(noRecord).toContainText(
      'Instagram does not include the post.',
    );
    await expect(noRecord.getByTestId('instagram-post')).toHaveCount(0);
    assertNoForeign(await page.getByTestId('archive').innerText());
    // A real human action through the app's protocol creates the delete entry.
    const decided = await page.evaluate(
      async (itemId) =>
        (window as ReviewWindow).workspace.request({
          type: 'decide',
          requestId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          itemIds: [itemId],
          expected: { [itemId]: 'undecided' },
          value: 'delete',
        }),
      own.id,
    );
    expect(decided.type).toBe('committed');
    await page.evaluate(() => {
      location.hash = '#/clicklist/instagram/go';
    });
    await expect(
      page.getByTestId('delete-card').getByTestId('instagram-post'),
    ).toContainText(own.text);
    assertNoForeign(await page.getByTestId('delete-card').innerText());
    expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual(
      [],
    );
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => Reflect.get(globalThis, '__contextViolations') as unknown,
      ),
    ).toEqual([]);
  } finally {
    await server.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a context reply for a different item or account cannot replace the focused comment, even during account switches', async ({
  page,
  context,
}) => {
  const workspace = await mkdtemp(
    join(tmpdir(), 'socialprune-context-identity-'),
  );
  const fixture = await writeContextFixture(workspace);
  const server = await startReviewServer({
    workspace,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
  });
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(server.launchUrl);
    await page.evaluate(() => {
      location.hash = '#/review';
    });
    await expect(page.getByTestId('instagram-post')).toContainText(own.text);
    // Test-only injected dependency: a mismatched record from an already valid
    // fixture. No environment flag or production fault route exists.
    await page.evaluate((record) => {
      (window as ReviewWindow).workspace.getInstagramContext = () =>
        Promise.resolve([record]);
    }, fixture.records.at(-1)!);
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption(contextInputs.foreign.account.key);
    await expect(
      page.getByTestId('review-card').locator('article'),
    ).toHaveAttribute('data-item-id', contextInputs.foreign.id);
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption(own.account.key);
    await expect(
      page.getByTestId('review-card').locator('article'),
    ).toHaveAttribute('data-item-id', own.id);
    await expect(page.getByTestId('instagram-post')).toHaveCount(0);
    await expect(page.getByTestId('review-card')).toContainText(
      'Instagram does not include the post.',
    );
    assertNoForeign(await page.getByTestId('review-card').innerText());
    // A correct item ID still cannot bring a foreign account's data in.
    await page.evaluate(
      (record) => {
        (window as ReviewWindow).workspace.getInstagramContext = () =>
          Promise.resolve([record]);
      },
      { ...fixture.records.at(-1)!, itemId: own.id },
    );
    await page.evaluate(() => {
      location.hash = '#/archive';
    });
    await expect(page.getByTestId('archive')).toBeVisible();
    await expect(page.getByTestId('instagram-post')).toHaveCount(0);
    assertNoForeign(await page.getByTestId('archive').innerText());
    expect(
      requests.filter(
        (url) => new URL(url).origin !== new URL(server.url).origin,
      ),
    ).toEqual([]);
  } finally {
    await server.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('context files and policies are absent from the production import closure as test controls', async () => {
  const server = await readFile(
    new URL('../src/review/server.ts', import.meta.url),
    'utf8',
  );
  const media = await readFile(
    new URL('../src/review/context-media.ts', import.meta.url),
    'utf8',
  );
  expect(server).not.toContain('context-fixture');
  expect(media).not.toContain('context-fixture');
  expect(media).not.toContain('process.env');
});
