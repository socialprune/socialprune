import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fixtureZips,
  waitForApp,
  importFiles,
  workspaceIds,
  observeImport,
} from './helpers.ts';

test('W1 closes and reopens the disposable browser profile with its decisions, history and two review filters', async ({
  browserName,
  baseURL,
}) => {
  // D40: 10.1 s in the full Windows run on 2026-10-08; existing 90 s exceeds 6x.
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'sp-w1-profile-'));
  const fixture = await fixtureZips('x', 'two-accounts');
  const browser = { chromium, firefox, webkit }[browserName];
  let context = await browser.launchPersistentContext(profile, {
    headless: true,
    baseURL,
    locale: 'en-US',
  });
  try {
    const first = await context.newPage();
    const firstAudit = await observeImport(context, first);
    await waitForApp(first);
    await importFiles(first, fixture.files);
    const item = fixture.expected.items[1]!;
    expect(item.account.key).not.toBe(fixture.expected.items[0]!.account.key);
    await first.evaluate(() => {
      location.hash = '#/review/list';
    });
    const account = first.getByRole('combobox', {
      name: 'Account',
      exact: true,
    });
    const decision = first.getByRole('combobox', {
      name: 'Decision filter',
      exact: true,
    });
    expect(
      await first.evaluate(() => window.workspace.summary?.review),
    ).toBeUndefined();
    await account.selectOption(item.account.key);
    await expect(first.getByRole('row')).toHaveCount(1);
    await expect(first.getByRole('row')).toContainText(item.text);
    await first.getByRole('grid').focus();
    await first.keyboard.press('l');
    await expect(first.getByTestId('save-state')).toHaveText(
      'Saved on this device',
    );
    await expect(first.getByRole('row')).toContainText('Later');
    await decision.selectOption('later');
    await expect(account).toHaveValue(item.account.key);
    await expect(decision).toHaveValue('later');
    await expect(first.getByRole('row')).toHaveCount(1);
    await first
      .getByRole('combobox', { name: 'Sort by', exact: true })
      .selectOption('createdAt');
    await first.getByRole('searchbox').fill(item.text);
    await expect(first.getByRole('row')).toHaveCount(1);
    await expect
      .poll(() =>
        first.evaluate(() => window.workspace.summary?.review?.search),
      )
      .toBe(item.text);
    await first.evaluate(() => window.workspace.flushCommands());
    await firstAudit.assert();
    await context.close();
    context = await browser.launchPersistentContext(profile, {
      headless: true,
      baseURL,
      locale: 'en-US',
    });
    const reopened = await context.newPage();
    const reopenedAudit = await observeImport(context, reopened);
    await waitForApp(reopened);
    expect(await workspaceIds(reopened)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    await reopened.evaluate(() => {
      location.hash = '#/review/list';
    });
    await expect(reopened.getByRole('grid')).toBeVisible();
    const reopenedAccount = reopened.getByRole('combobox', {
      name: 'Account',
      exact: true,
    });
    const reopenedDecision = reopened.getByRole('combobox', {
      name: 'Decision filter',
      exact: true,
    });
    // Read both controls before changing the view to inspect the durable decision.
    const resumedFilters = {
      account: await reopenedAccount.inputValue(),
      decision: await reopenedDecision.inputValue(),
      sort: await reopened
        .getByRole('combobox', { name: 'Sort by', exact: true })
        .inputValue(),
      search: await reopened.getByRole('searchbox').inputValue(),
    };
    await reopened
      .getByRole('button', { name: 'History', exact: true })
      .click();
    await expect(reopened.getByRole('dialog')).toContainText('1 entry: Later');
    await reopened
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await reopenedAccount.selectOption(item.account.key);
    await expect(reopened.getByRole('row')).toHaveCount(1);
    await expect(reopened.getByRole('row')).toContainText(item.text);
    await expect(reopened.getByRole('row')).toContainText('Later');
    expect(resumedFilters).toEqual({
      account: item.account.key,
      decision: 'later',
      sort: 'createdAt',
      search: item.text,
    });
    await reopenedAudit.assert();
  } finally {
    await context.close();
    await fixture.cleanup();
    await rm(profile, { recursive: true, force: true });
  }
});
