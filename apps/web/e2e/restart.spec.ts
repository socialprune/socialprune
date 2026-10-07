import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fixtureZips,
  waitForApp,
  importFiles,
  workspaceIds,
} from './helpers.ts';

test('W1 closes and reopens the disposable browser profile with its workspace and history', async ({
  browserName,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'sp-w1-profile-'));
  const fixture = await fixtureZips('x', 'current-minimal');
  const browser = { chromium, firefox, webkit }[browserName];
  let context = await browser.launchPersistentContext(profile, {
    headless: true,
    baseURL,
    locale: 'en-US',
  });
  try {
    const first = await context.newPage();
    await waitForApp(first);
    await importFiles(first, fixture.files);
    const itemId = fixture.expected.items[0]!.id;
    const result = await first.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'decide',
          requestId: 'durable-decision',
          commandId: 'restart-command',
          itemIds: [itemId],
          value: 'later',
          expected: { [itemId]: 'undecided' },
        }),
      itemId,
    );
    expect(result.type).toBe('committed');
    await context.close();
    context = await browser.launchPersistentContext(profile, {
      headless: true,
      baseURL,
      locale: 'en-US',
    });
    const reopened = await context.newPage();
    await waitForApp(reopened);
    expect(await workspaceIds(reopened)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    const resultAfter = await reopened.evaluate(() =>
      window.workspace.request({
        type: 'history',
        requestId: 'durable-history',
        limit: 50,
      }),
    );
    expect(resultAfter).toMatchObject({
      type: 'historyEntries',
      entries: [{ value: 'later', size: 1 }],
    });
  } finally {
    await context.close();
    await fixture.cleanup();
    await rm(profile, { recursive: true, force: true });
  }
});
