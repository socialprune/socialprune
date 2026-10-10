import { expect, test } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceV2 } from '@socialprune/core';

// Screenshots of the person-facing views on the demo, for design review.
const folder = join(tmpdir(), 'socialprune-screens');

test('phase 1 screenshots use the real demo, human commands and a test-only self-thread variation', async ({
  page,
  context,
}) => {
  await mkdir(folder, { recursive: true });
  const requests: string[] = [],
    errors: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('sp-locale', 'de');
    localStorage.setItem('sp-theme', 'light');
    // Use the browser download branch, not a native file chooser.
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  await page.goto('/socialprune/#/demo');
  await expect(page.getByTestId('card-review')).toBeVisible();
  await expect(
    page.getByTestId('review-card').locator('article'),
  ).toBeVisible();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.workspace.summary?.counts.items))
    .toBe(420);
  const firstId = await page
    .getByTestId('review-card')
    .locator('article')
    .getAttribute('data-item-id');
  const firstRisk = await page.evaluate(async (itemId) => {
    const reply = await window.workspace.request({
      type: 'detail',
      requestId: crypto.randomUUID(),
      itemId,
    });
    return reply.type === 'itemDetail'
      ? Math.max(...reply.assessments.map((entry) => entry.risk))
      : -1;
  }, firstId!);
  expect(firstRisk).toBe(2);
  await page
    .getByRole('combobox', { name: 'Was du durchsehen willst' })
    .focus();
  await page.keyboard.press('j');
  const noKeyDecision = await page.evaluate(() => window.workspace.open());
  expect(noKeyDecision).toMatchObject({
    type: 'opened',
    summary: { decisions: { delete: 0 } },
  });
  await page.evaluate(() => {
    location.hash = '#/review';
  });
  await expect(
    page.getByRole('heading', { name: 'Durchsehen', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('heading', { name: 'Durchsehen', exact: true })
    .evaluate((element) => (element as HTMLElement).blur());
  await page.screenshot({
    path: `${folder}/01-review-de-1440.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
  await page.screenshot({
    path: `${folder}/11-navigation-menu-de-1440.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: `${folder}/02-review-de-390.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  await page.screenshot({
    path: `${folder}/12-navigation-menu-de-390.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });

  const original = await page
    .getByTestId('review-card')
    .locator('article')
    .getAttribute('data-item-id');
  await page
    .getByTestId('review-card')
    .evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', repeat: true, bubbles: true }),
      ),
    );
  await page.evaluate(() => localStorage.setItem('sp-single-keys', 'off'));
  await page.getByTestId('review-card').focus();
  await page.keyboard.press('j');
  const disabledKeyDecision = await page.evaluate(() =>
    window.workspace.open(),
  );
  expect(disabledKeyDecision).toMatchObject({
    type: 'opened',
    summary: { decisions: { delete: 0 } },
  });
  await page.evaluate(() => localStorage.setItem('sp-single-keys', 'on'));
  await page.getByTestId('review-card').focus();
  await page.keyboard.press('k');
  await expect(
    page.getByTestId('review-card').locator('article'),
  ).not.toHaveAttribute('data-item-id', original!);
  const saved = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    original!,
  );
  expect(saved).toMatchObject({
    type: 'itemDetail',
    events: [{ value: 'keep', source: { kind: 'human', via: 'web-review' } }],
  });
  await page.getByTestId('review-card').focus();
  await page.keyboard.press('u');
  await expect(
    page.getByTestId('review-card').locator('article'),
  ).toHaveAttribute('data-item-id', original!);

  await page
    .getByRole('button', { name: 'Vorschläge übernehmen', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', {
    name: /^Zum Löschen vormerken:/,
  });
  await expect(confirm).toBeEnabled();
  await dialog.locator('summary').click();
  await page.screenshot({
    path: `${folder}/03-bulk-preview-de.png`,
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const cancelled = await page.evaluate(() => window.workspace.open());
  expect(cancelled).toMatchObject({
    type: 'opened',
    summary: { decisions: { delete: 0 } },
  });
  await page
    .getByRole('button', { name: 'Vorschläge übernehmen', exact: true })
    .click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  const marked = await page.evaluate(() => window.workspace.open());
  expect(marked).toMatchObject({
    type: 'opened',
    summary: { decisions: { keep: 0 } },
  });
  if (marked.type !== 'opened') throw new Error('Demo summary missing');
  expect(marked.summary.decisions.delete).toBeGreaterThan(0);

  await page.evaluate(() => {
    location.hash = '#/clicklist/x/go';
  });
  await expect(
    page.getByTestId('delete-card').locator('article'),
  ).toBeVisible();
  await page.screenshot({
    path: `${folder}/04-delete-mode-de.png`,
    fullPage: true,
  });
  // The normal link stays a real user-controlled new-tab link. Do not visit X.
  const open = page.getByTestId('delete-card').locator('[data-open-platform]');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await open.evaluate((link) => {
    const anchor = link as HTMLAnchorElement;
    let clicks = 0;
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      clicks++;
      Reflect.set(window, '__prototypeLinkClicks', clicks);
    });
  });
  await page.getByTestId('delete-card').focus();
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() =>
      Number(Reflect.get(window, '__prototypeLinkClicks')),
    ),
  ).toBe(1);
  await page.getByTestId('delete-card').evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        repeat: true,
        bubbles: true,
      }),
    ),
  );
  expect(
    await page.evaluate(() =>
      Number(Reflect.get(window, '__prototypeLinkClicks')),
    ),
  ).toBe(1);
  const deletedId = await page
    .getByTestId('delete-card')
    .locator('article')
    .getAttribute('data-item-id');
  await page.getByRole('button', { name: /^Erledigt/ }).click();
  await expect(
    page.getByTestId('delete-card').locator('article'),
  ).not.toHaveAttribute('data-item-id', deletedId!);
  const deleted = await page.evaluate(
    (itemId) =>
      window.workspace.request({
        type: 'detail',
        requestId: crypto.randomUUID(),
        itemId,
      }),
    deletedId!,
  );
  expect(deleted.type).toBe('itemDetail');
  if (deleted.type !== 'itemDetail') throw new Error('Deleted detail missing');
  expect(deleted.events.at(-1)).toMatchObject({
    value: 'deleted-by-user',
    source: { kind: 'human', via: 'web-review' },
  });
  await page.getByTestId('delete-card').focus();
  await page.keyboard.press('Space');
  await expect
    .poll(async () => {
      const reply = await page.evaluate(() => window.workspace.open());
      return reply.type === 'opened'
        ? reply.summary.outcomes['deleted-by-user']
        : -1;
    })
    .toBe(2);

  await page.evaluate(() => {
    location.hash = '#/archive';
  });
  await expect(page.getByTestId('recap')).toBeVisible();
  await page.screenshot({
    path: `${folder}/05-archive-original-demo-de.png`,
    fullPage: false,
  });
  await page
    .getByTestId('recap')
    .screenshot({ path: `${folder}/06-recap-de.png` });
  await page
    .getByRole('searchbox', { name: 'Im Archiv suchen' })
    .fill('borrowed');
  await expect(page.locator('article').first()).toContainText('borrowed');
  await page.getByRole('searchbox', { name: 'Im Archiv suchen' }).fill('');
  await page
    .getByRole('combobox', { name: 'Art des Eintrags', exact: true })
    .selectOption('repost');
  await expect(page.locator('article').first()).toContainText('Repost von @');
  await page
    .getByRole('combobox', { name: 'Art des Eintrags', exact: true })
    .selectOption('all');
  await page
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption({ label: '@demo_fern' });
  await expect(page.locator('article').first()).toContainText(
    'Kommentar bei @',
  );
  await page.screenshot({
    path: `${folder}/07-instagram-archive-de.png`,
    fullPage: false,
  });

  await page.evaluate(() => {
    location.hash = '#/review/list';
  });
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('row').first()).toBeVisible();
  await page
    .getByRole('heading', { name: 'Durchsehen', exact: true })
    .evaluate((element) => (element as HTMLElement).blur());
  await page.screenshot({
    path: `${folder}/08-old-grid-de.png`,
    fullPage: true,
  });

  // Capture the built-in demo through its real backup UI, then make only
  // generated-data variations in this test. Production demo inputs stay intact.
  await page.evaluate(() => {
    location.hash = '#/backup';
  });
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Backup herunterladen', exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('No demo backup download');
  const backup = JSON.parse(await readFile(path, 'utf8')) as WorkspaceV2;
  const xItems = backup.items
    .filter((item) => item.platform === 'x')
    .sort((a, b) => a.id.localeCompare(b.id));
  const root = xItems[297]!,
    middle = xItems[298]!,
    end = xItems[299]!;
  root.kind = 'post';
  root.reference.replyToId = null;
  root.reference.replyToHandle = null;
  root.createdAt = '2018-11-09T15:00:00.000Z';
  for (const [item, parent, minute] of [
    [middle, root, '05'],
    [end, middle, '10'],
  ] as const) {
    item.kind = 'reply';
    item.reference.replyToId = parent.id.slice(2);
    item.reference.replyToHandle = item.account.handle;
    item.createdAt = `2018-11-09T15:${minute}:00.000Z`;
  }
  xItems[291]!.createdAt = '2018-11-09T15:08:00.000Z';
  backup.items.find((item) => item.id === deletedId)!.createdAt =
    '2018-11-09T15:06:00.000Z';
  if (backup.settings.review)
    backup.settings.review.accountKey = root.account.key;
  await page.evaluate(() => {
    location.hash = '#/';
  });
  await expect(page.locator('main')).toHaveAttribute('data-gate', 'ready');
  await page.evaluate(() => {
    location.hash = '#/backup';
  });
  await page.getByLabel('SocialPrune-Backup-Datei').setInputFiles({
    name: 'generated-demo-thread-variation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(
    page.getByRole('button', { name: 'Dieses Backup wiederherstellen' }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Dieses Backup wiederherstellen' })
    .click();
  await expect(
    page.getByText(
      'Das Backup wurde wiederhergestellt. Dieser Browser nutzt jetzt diese Durchsicht.',
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/archive';
  });
  await expect(page.getByTestId('recap')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Konto', exact: true })
    .selectOption(root.account.key);
  await expect(page.locator('[data-thread-size="3"]')).toBeVisible();
  await expect(
    page.locator(`article[data-item-id="${deletedId}"]`),
  ).toContainText('auf X gelöscht');
  await expect(
    page
      .locator('article')
      .filter({ hasText: 'Antwort an @plum_gecko' })
      .first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 2050 });
  await page.screenshot({
    path: `${folder}/09-archive-thread-reply-deleted-de.png`,
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const lastVisible = page.locator(`article[data-item-id="${deletedId}"]`);
  const box = await lastVisible.boundingBox();
  if (!box) throw new Error('Deleted badge crop missing');
  await page.screenshot({
    path: `${folder}/10-archive-thread-de-390.png`,
    fullPage: true,
    clip: {
      x: 0,
      y: 0,
      width: 390,
      height: Math.ceil(box.y + box.height + 24),
    },
  });

  expect(errors).toEqual([]);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  console.log(
    JSON.stringify({
      screenshots: 12,
      requests: requests.length,
      offOrigin: 0,
      humanDecision: true,
      humanOutcome: true,
      repeatLinkSuppressed: true,
      demoThreadVariation: true,
    }),
  );
});
