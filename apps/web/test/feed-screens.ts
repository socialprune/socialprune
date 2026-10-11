import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedFixture, largeFeedFixture, feedExpected } from './feed-fixture.ts';

const origin = process.argv[2] ?? 'http://127.0.0.1:4241';
const url = new URL(origin);
if (
  url.hostname !== '127.0.0.1' ||
  url.protocol !== 'http:' ||
  url.pathname !== '/' ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
)
  throw new Error('Local app origin required');
const folder = join(tmpdir(), 'socialprune-screens');
await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: 'de-DE',
    colorScheme: 'light',
  });
  const requests: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('sp-locale', 'de');
    localStorage.setItem('sp-theme', 'light');
  });
  await page.goto(`${origin}/socialprune/#/import`);
  await expect(page.locator('main')).toHaveAttribute('data-gate', 'ready');
  const data = feedFixture();
  data.items[19]!.kind = 'reply';
  data.items[19]!.reference.replyToId = '1234567890';
  data.items[19]!.reference.replyToHandle = 'generated_other';
  await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-feed-screens.json'),
      }),
    JSON.stringify(data),
  );
  await page.goto(`${origin}/socialprune/#/review`);
  await expect(
    page.getByTestId('review-card').locator('article'),
  ).toBeVisible();
  await page
    .getByTestId('card-review')
    .getByRole('button', { name: 'Alle', exact: true })
    .click();
  const feed = page.getByTestId('review-overview');
  await expect(feed.getByTestId('feed-count')).toHaveText(
    '0 von 6 entschieden',
  );
  await expect(feed.getByTestId('popular-badge')).toHaveCount(2);
  await page.screenshot({
    path: join(folder, '18-overview-de-1440.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(folder, '19-overview-de-390.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await feed
    .getByRole('button', { name: 'Vorschläge übernehmen', exact: true })
    .click();
  await expect(page.getByTestId('bulk-popular-count')).toContainText(
    '2 beliebte Einträge bleiben ausgenommen',
  );
  expect(
    await page
      .getByRole('dialog')
      .getByRole('heading')
      .evaluate((heading) => {
        const box = heading.getBoundingClientRect();
        return !!document
          .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          ?.closest('[role="dialog"]');
      }),
  ).toBe(true);
  await page.screenshot({
    path: join(folder, '20-overview-bulk-popular-de.png'),
    fullPage: true,
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Abbrechen', exact: true })
    .click();
  await feed
    .getByTestId('feed-card')
    .first()
    .getByRole('button', { name: 'Behalten K', exact: true })
    .click();
  await expect(feed.getByTestId('feed-count')).toHaveText(
    '1 von 6 entschieden',
  );
  await page.screenshot({
    path: join(folder, '21-overview-decision-de.png'),
    fullPage: true,
  });
  await feed
    .getByRole('button', { name: 'Vorschläge übernehmen', exact: true })
    .click();
  const apply = page.getByRole('dialog').getByRole('button', {
    name: 'Zum Löschen vormerken: 3 Einträge',
    exact: true,
  });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(feed.getByTestId('popular-waiting-count')).toHaveText(
    '2 beliebte Einträge warten noch',
  );
  await feed
    .getByRole('checkbox', {
      name: 'Nur beliebte offene Einträge',
      exact: true,
    })
    .check();
  await expect(feed.getByTestId('feed-card')).toHaveCount(2);
  await page.screenshot({
    path: join(folder, '23-overview-popular-waiting-de.png'),
    fullPage: true,
  });
  await page.goto(`${origin}/socialprune/#/import`);
  await expect(page.getByTestId('import-state')).toBeVisible();
  await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-large-feed.json'),
      }),
    JSON.stringify(largeFeedFixture()),
  );
  await page.goto(`${origin}/socialprune/#/review`);
  await expect(page.getByTestId('review-card')).toBeVisible();
  await page
    .getByTestId('card-review')
    .getByRole('button', { name: 'Alle', exact: true })
    .click();
  await expect(feed.getByTestId('feed-count')).toHaveText(
    '0 von 100 entschieden',
  );
  await page.screenshot({
    path: join(folder, '22-overview-virtual-de-1440.png'),
    fullPage: true,
  });
  expect(
    requests.filter((request) => new URL(request).origin !== origin),
  ).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      folder,
      screenshots: 6,
      originRequests: requests.length,
      fixtureThreshold: feedExpected.threshold,
    }),
  );
} finally {
  await browser.close();
}
