import { expect, test } from '@playwright/test';
import { launch } from './helpers.ts';

test('foundation: packaged app -> preload -> main -> utility SQLite -> reply -> clean quit', async () => {
  const app = await launch();
  try {
    expect(await app.page.title()).toBe('SocialPrune');
    expect(app.page.url()).toBe('app://socialprune/index.html');
    expect(await app.page.locator('#status').textContent()).toBe(
      String(app.items),
    );
    const reply = await app.page.evaluate(() =>
      window.socialprune.request({
        type: 'foundationRead',
        requestId: crypto.randomUUID(),
      }),
    );
    expect(reply).toMatchObject({
      type: 'foundationSummary',
      items: app.items,
    });
    expect(app.errors).toEqual([]);
    console.log(
      JSON.stringify({
        proof: 'foundation',
        startupMs: app.startupMs,
        items: app.items,
        reply,
      }),
    );
  } finally {
    await app.close();
  }
});
