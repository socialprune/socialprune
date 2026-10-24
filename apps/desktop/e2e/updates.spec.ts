import { expect, test } from '@playwright/test';
import { launch } from './helpers.ts';

test('installed version comes from Electron and the update click reaches only the main opener recorder', async () => {
  const app = await launch('probe', true);
  try {
    const version = await app.application.evaluate(({ app }) =>
      app.getVersion(),
    );
    await app.page
      .getByRole('button', { name: 'Data and backups', exact: true })
      .click();
    await expect(app.page.getByTestId('desktop-updates')).toContainText(
      `Installed version: ${version}`,
    );
    const links = () =>
      app.application.evaluate(
        () =>
          (Reflect.get(globalThis, 'desktopProbe') as { links: string[] })
            .links,
      );
    expect(await links()).toEqual([]);
    await app.page
      .getByTestId('desktop-updates')
      .getByRole('button', { name: 'Check for updates', exact: true })
      .click();
    await expect
      .poll(links)
      .toEqual(['https://github.com/socialprune/socialprune/releases']);
    expect(app.requests.every((url) => new URL(url).protocol === 'app:')).toBe(
      true,
    );
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
