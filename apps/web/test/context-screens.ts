import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postContextFixture } from './post-context-fixture.ts';
import { personExpected } from './person-fixture.ts';

// Capture separately from the render-policy audit: Playwright screenshots may
// insert transient style nodes in WebKit. This utility never enters the app.
const origin = process.argv[2] ?? 'http://127.0.0.1:4201';
const parsed = new URL(origin);
if (
  parsed.protocol !== 'http:' ||
  parsed.hostname !== '127.0.0.1' ||
  parsed.pathname !== '/' ||
  parsed.search ||
  parsed.hash ||
  parsed.username ||
  parsed.password
)
  throw new Error('A local app origin is required.');
const folder = join(tmpdir(), 'socialprune-screens');
await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  });
  const requests: string[] = [],
    errors: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('sp-locale', 'de');
    localStorage.setItem('sp-theme', 'light');
  });
  await page.goto(`${origin}/socialprune/#/import`);
  await expect(page.locator('main')).toHaveAttribute('data-gate', 'ready');
  const result = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-context-screens.json'),
      }),
    JSON.stringify(postContextFixture()),
  );
  expect(result.type).toBe('opened');
  await page.goto(`${origin}/socialprune/#/review`);
  await page
    .getByTestId('card-review')
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption(personExpected.accountKey);
  const card = page.getByTestId('review-card');
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    personExpected.suggestionIds[0],
  );
  await page
    .getByRole('button', { name: 'Nächster Beitrag', exact: true })
    .click();
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    personExpected.foreignReplyId,
  );
  await expect(
    card.getByRole('link', { name: 'Original auf X ansehen', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(folder, '13-context-review-reply-de.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(folder, '14-context-review-reply-de-390.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', { name: 'Nächster Beitrag', exact: true })
    .click();
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    'x:review-0006',
  );
  await page
    .getByRole('button', { name: 'Nächster Beitrag', exact: true })
    .click();
  await expect(card.locator('article')).toHaveAttribute(
    'data-item-id',
    'x:review-0005',
  );
  await page.screenshot({
    path: join(folder, '15-context-review-quote-de.png'),
    fullPage: true,
  });
  await page.goto(`${origin}/socialprune/#/archive`);
  await page
    .getByTestId('archive')
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption(personExpected.accountKey);
  await expect(page.getByTestId('recap')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Original auf X ansehen', exact: true }),
  ).toHaveCount(2);
  await page.screenshot({
    path: join(folder, '16-context-archive-de.png'),
    fullPage: true,
  });
  await page
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption('synthetic-comment');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText(
    'Instagram liefert den Beitrag nicht mit.',
  );
  await page.screenshot({
    path: join(folder, '17-context-instagram-de.png'),
    fullPage: true,
  });
  expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      screenshots: 5,
      originOnlyRequests: requests.length,
      folder,
    }),
  );
} finally {
  await browser.close();
}
