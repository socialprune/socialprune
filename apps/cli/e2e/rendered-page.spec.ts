import { expect, test } from '@playwright/test';
import { xSelectors } from '../src/browser/x/selectors.ts';
import { compareFocal } from '../src/browser/x/fill/compare.ts';
import { migrateOriginal } from '@socialprune/core';
import { startConfirmation } from '../src/browser/confirmation.ts';
test('delayed side nav waits for script rendering before account read; an empty page stops at the bounded render deadline', async ({
  page,
}) => {
  await page.setContent(
    '<main id="root"></main><script>setTimeout(()=>document.getElementById("root").innerHTML=\'<button data-testid="SideNav_AccountSwitcher_Button">@generated_account</button>\',100)</script>',
  );
  expect(await xSelectors.account(page)).toBe('generated_account');
  await page.setContent('<main></main>');
  await expect(xSelectors.account(page, 100)).rejects.toMatchObject({
    code: 'PLATFORM_CHECK',
  });
});
test('focal article identity excludes every other timestamped post from state and menu selection', async ({
  page,
}) => {
  await page.setContent(
    '<article data-testid="tweet"><a href="/generated/status/900"><time>2026</time></a><button data-testid="caret">Other</button></article><article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><button data-testid="caret">Focal</button><button data-testid="unretweet">Focal repost</button></article>',
  );
  expect(await xSelectors.state(page, '910')).toBe('present');
  expect(await (await xSelectors.more(page, '910')).innerText()).toBe('Focal');
  expect(await (await xSelectors.repost(page, '910')).innerText()).toBe(
    'Focal repost',
  );
});
test('automatic comparison normalizes whitespace and known t.co link rendering, counts focal media only and rejects missing tail', async ({
  page,
}) => {
  const base = migrateOriginal({
    id: '910',
    status: 'fetched',
    fetchedAt: '2026-10-13T12:00:00.000Z',
    text: 'Generated\nvisit https://t.co/generatedLink',
    authorName: null,
    authorHandle: null,
    photos: [],
    quotedId: null,
    parentId: null,
    raw: null,
    textCompleteness: 'unknown',
    video: null,
  });
  base.textCompleteness = 'full';
  base.media = [
    {
      n: 1,
      kind: 'photo',
      source: 'anonymous',
      url: null,
      file: null,
      poster: null,
      status: 'failed',
      bytes: null,
      durationMs: null,
      bitrateLabel: null,
      altText: null,
    },
    {
      n: 2,
      kind: 'video',
      source: 'anonymous',
      url: null,
      file: null,
      poster: null,
      status: 'not-stored',
      bytes: null,
      durationMs: null,
      bitrateLabel: null,
      altText: null,
    },
  ];
  await page.setContent(
    '<article data-testid="tweet"><a href="/generated/status/999"><time>2026</time></a><p data-testid="tweetText">Generated unrelated article</p><div data-testid="tweetPhoto"></div></article><article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><p data-testid="tweetText">Generated visit <a href="https://t.co/generatedLink">example.org/generated</a></p><div data-testid="tweetPhoto"></div><div data-testid="videoPlayer"><video></video></div></article>',
  );
  expect((await compareFocal(page, base)).matches).toBe(true);
  expect(
    (
      await compareFocal(page, {
        ...base,
        text: base.text + ' missing generated tail',
      })
    ).matches,
  ).toBe(false);
});
test('an older in-flight confirmation poll cannot overwrite the ended state', async ({
  page,
}) => {
  const initial = {
    phase: 'start' as const,
    warning: 'Generated',
    profileWarning: 'Generated',
    planned: 0,
    bulk: 0,
    estimateMs: 0,
    list: 'generated',
    rows: [],
    completed: 0,
    result: 'Generated initial',
  };
  const server = await startConfirmation(initial, 4232);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let delivered!: () => void;
  const staleDelivered = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let calls = 0;
  await page.route('**/api/view', async (route) => {
    calls++;
    if (calls === 2) {
      const reply = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response: reply });
      delivered();
    } else await route.continue();
  });
  // Delay/reorder only test responses, not a production fault flag or fake script.
  await page.route('**/api/action', async (route) => {
    server.update({ phase: 'ended', result: 'Ended: Generated final.' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...initial,
        phase: 'ended',
        version: 2,
        result: 'Ended: Generated final.',
      }),
    });
  });
  try {
    await page.goto(server.launchUrl);
    await expect(page.locator('#start')).toBeVisible();
    await ready;
    await page.locator('#start').click();
    await expect(page.locator('#result')).toHaveText('Ended: Generated final.');
    release();
    await staleDelivered;
    await expect.poll(() => calls).toBeGreaterThan(2);
    await expect(page.locator('#result')).toHaveText('Ended: Generated final.');
    await expect(page.locator('#start')).toBeHidden();
  } finally {
    release();
    await server.close();
  }
});
