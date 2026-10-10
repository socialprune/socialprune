import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers.ts';
import { startStaticServer } from './static-server.ts';
import { menuLink } from './navigation.ts';

test('W0 shell keyboard routes, 320px German layout, dark mode and reduced motion', async ({
  page,
}) => {
  await waitForApp(page);
  await (await menuLink(page, 'Start')).click();
  expect(
    await page
      .getByRole('button', { name: 'Open export', exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor),
  ).toBe('rgb(29, 78, 216)');
  expect(
    await page
      .getByRole('heading', { name: 'SocialPrune', exact: true })
      .evaluate((heading) => getComputedStyle(heading).fontSize),
  ).toBe('30px');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await page
    .getByTestId('app-menu')
    .getByRole('link', { name: 'Einstellungen', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Einstellungen' }),
  ).toBeFocused();
  await page
    .getByRole('combobox', { name: 'Darstellung' })
    .selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('html')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--motion-duration').trim(),
      ),
  ).toBe('0ms');
  await (await menuLink(page, 'Datenschutz')).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Datenschutz' }),
  ).toBeFocused();
  expect(await page.locator('style').count()).toBe(0);
  await page.goto('/socialprune/#/review');
  await expect(
    page.getByRole('heading', { name: 'Durchsehen', exact: true }),
  ).toBeVisible();
  await page.goto('/socialprune/#/does-not-exist');
  await expect(
    page.getByRole('heading', { name: 'Seite nicht gefunden' }),
  ).toBeVisible();
});

test('W0 every shell route reloads from the cache with its actual server stopped', async ({
  page,
}) => {
  const server = await startStaticServer(4182);
  try {
    await page.goto(`${server.origin}/socialprune/`);
    await expect(page.locator('main[data-gate]')).toHaveAttribute(
      'data-gate',
      'ready',
    );
  } finally {
    await server.close();
  }
  for (const path of ['', '#/guide', '#/demo', '#/privacy', '#/settings']) {
    await page.goto(`${server.origin}/socialprune/${path}`);
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.locator('main[data-gate]')).toHaveAttribute(
      'data-gate',
      'ready',
    );
    await expect(page.locator('main h1')).toBeVisible();
  }
});

test('W0 first-visit frame blocks privileged UI and controlled HTML cannot be framed', async ({
  page,
  context,
}) => {
  const server = await startStaticServer(4182);
  const frame = await context.newPage();
  try {
    await frame.goto(`${server.origin}/socialprune/test-parent`);
    await frame.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.src = '/socialprune/#/import';
      document.body.append(iframe);
    });
    const embedded = frame.frameLocator('iframe');
    await expect(
      embedded.getByRole('heading', { name: 'Open SocialPrune directly' }),
    ).toBeVisible();
    expect(await embedded.locator('input[type="file"]').count()).toBe(0);
    await page.goto(`${server.origin}/socialprune/#/import`);
    await expect(page.locator('main[data-gate]')).toHaveAttribute(
      'data-gate',
      'ready',
    );
    await page.reload();
    await frame.reload();
    await frame.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.src = '/socialprune/#/import';
      document.body.append(iframe);
    });
    await expect
      .poll(
        () =>
          frame.frames().filter((child) => child.url().includes('#/import'))
            .length,
      )
      .toBe(0);
  } finally {
    await frame.close();
    await server.close();
  }
});
