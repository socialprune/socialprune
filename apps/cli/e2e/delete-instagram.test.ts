import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { chromium } from '@playwright/test';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { createProfile } from '../src/browser/profile.ts';
import { startConfirmation } from '../src/browser/confirmation.ts';
import { productionContext } from '../src/browser/instagram/driver.ts';
import {
  checkInstagramDeletePage,
  instagramDeleteIdentity,
  clickInstagramDelete,
  instagramDeleteUiConfirmed,
  verifyInstagramComment,
  expandInstagramDeleteComment,
} from '../src/browser/instagram/delete-driver.ts';
import { runInstagramDeletion } from '../src/browser/instagram/delete-run.ts';
import { planInstagramDeletion } from '../src/browser/instagram/delete-plan.ts';
import { fakeInstagram } from './fake-instagram/server.ts';
import { instagramDeleteFixture } from './fake-instagram/delete-fixture.ts';
import type { DeleteCase } from './fake-instagram/delete-page.ts';

async function generatedRun(
  scenario: DeleteCase | 'extension-change',
  afterCanary = false,
) {
  const root = await mkdtemp(join(tmpdir(), 'sp-d10-browser-'));
  const workspace = await instagramDeleteFixture(afterCanary ? 3 : 2),
    account = workspace.items[0]!.account.key;
  const store = await SQLiteStore.open(join(root, 'socialprune.sqlite'), {
    initial: workspace,
  });
  const profile = join(root, 'profile');
  await createProfile(profile, 'instagram');
  const server = await fakeInstagram(4871, workspace.items);
  server.deletionCase(scenario === 'extension-change' ? 'success' : scenario);
  let clock = Date.parse('2026-10-25T12:00:00.000Z');
  let plan = await planInstagramDeletion(store, account, new Date(clock));
  const execute = () =>
    runInstagramDeletion(
      {
        store,
        workspace: root,
        plan,
        profile,
        executablePath: chromium.executablePath(),
        lang: 'en',
        list: '',
        verify: false,
        now: () => new Date(clock),
        signal: new AbortController().signal,
        notice: () => {},
      },
      {
        ...productionContext,
        origin: server.origin,
        port: 4872,
        responseMs: 5000,
        policy: {
          platform: (input) => new URL(input).origin === server.origin,
          image: () => false,
        },
        launch: async (directory) => {
          const context = await chromium.launchPersistentContext(directory, {
            headless: true,
            offline: true,
            serviceWorkers: 'block',
          });
          const control = async (page: import('playwright-core').Page) => {
            try {
              await page.waitForURL('http://127.0.0.1:4872/**', {
                timeout: 15000,
              });
              await page
                .getByRole('button', { name: 'Start', exact: true })
                .click();
              await page
                .getByRole('button', { name: 'Continue', exact: true })
                .click({ timeout: 12000 });
            } catch {
              /* Refused canaries and ended contexts expose no Continue. */
            }
          };
          for (const page of context.pages()) void control(page);
          context.on('page', (page) => {
            void control(page);
          });
          return context;
        },
        sleep: async (ms) => {
          clock += ms;
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
        close: async (context) => {
          await context.close();
        },
        confirmation: startConfirmation,
        checkPage: checkInstagramDeletePage,
        identity: instagramDeleteIdentity,
        click: async (page, row, handle, origin, before) => {
          if (scenario === 'extension-change')
            await mkdir(
              join(
                profile,
                'Default',
                'Extensions',
                'abcdefghijklmnopabcdefghijklmnop',
              ),
              { recursive: true },
            );
          await clickInstagramDelete(page, row, handle, origin, before);
        },
        uiConfirmed: instagramDeleteUiConfirmed,
        verify: verifyInstagramComment,
        expand: expandInstagramDeleteComment,
      },
    );
  try {
    if (afterCanary) {
      server.deletionCase('success');
      expect(await execute()).toMatchObject({
        completed: 1,
        endReason: 'canary',
      });
      clock += 60000;
      plan = await planInstagramDeletion(store, account, new Date(clock));
      expect(plan.canary).toBe(false);
      server.deletionCase(scenario as DeleteCase);
    }
    const result = await execute();
    const journal = await store.browserJournal();
    return {
      result,
      journal,
      attempts: [...server.deleteAttempts],
      nextPlan: await planInstagramDeletion(store, account, new Date(clock)),
      warning: await store
        .browserOutcomeWriter()
        .xWarning(account, undefined, 'instagram'),
    };
  } finally {
    await server.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}
test.each(['extra-field', 'ambiguous'] as const)(
  'D12 A main %s after accepted canary forces a fresh watched comment',
  async (scenario) => {
    const { result, nextPlan, attempts } = await generatedRun(scenario, true);
    expect(result.completed).toBe(0);
    expect(nextPlan.canary).toBe(true);
    expect(nextPlan.rows).toHaveLength(1);
    expect(attempts).toHaveLength(2);
  },
);
test.each(['notice-caption', 'notice-comment', 'notice-dialog'] as const)(
  'D12 B deletion %s distinguishes ordinary content from a platform dialog',
  async (scenario) => {
    const { result, warning, attempts } = await generatedRun(scenario);
    if (scenario === 'notice-dialog') {
      expect(result.endReason).toBe('platform-check');
      expect(attempts).toHaveLength(0);
      expect(warning?.acknowledged).toBe(false);
    } else {
      expect(result).toMatchObject({ completed: 1, endReason: 'canary' });
      expect(warning).toBeNull();
    }
  },
);
test('D10 foundation: real browser page crosses human Start, sending, one allowed request, receipt and watched single-comment canary settlement', async () => {
  const { result, journal, attempts } = await generatedRun('success');
  expect(result).toMatchObject({
    completed: 1,
    endReason: 'canary',
    code: null,
  });
  expect(attempts).toEqual(['191919191919191919']);
  expect(
    journal.attempts
      .filter((a) => a.action === 'delete-comment')
      .map((a) => a.state),
  ).toEqual(['sending', 'deleted']);
  expect(
    journal.runs.findLast((r) => r.mode === 'delete')?.canaryAcceptedAt,
  ).toBeTruthy();
});
test.each([
  'http-429',
  'feedback_required',
  'please_wait',
  'spam',
  'Action Blocked',
  'Try again later',
] as const)(
  'D10 %s stops on the first attempt and gates later deletion',
  async (scenario) => {
    const { result, journal, attempts, warning } = await generatedRun(scenario);
    expect(result.endReason).toBe('platform-check');
    expect(attempts).toHaveLength(1);
    expect(warning?.acknowledged).toBe(false);
    expect(
      journal.attempts.filter((a) => a.action === 'delete-comment').at(-1)
        ?.state,
    ).toBe('ambiguous');
  },
);
test.each([
  'wrong-id',
  'wrong-time',
  'wrong-owner',
  'wrong-account',
  'wrong-language',
  'extension-change',
  'login',
  'challenge',
] as const)('D10 %s refuses before any deletion request', async (scenario) => {
  const { result, attempts } = await generatedRun(scenario);
  expect(result.completed).toBe(0);
  expect(attempts).toEqual([]);
});
test.each([
  'ambiguous',
  'generic-error',
  'checkpoint_required',
  'second-write',
] as const)('D10 %s never reports a confirmed deletion', async (scenario) => {
  const { result, journal } = await generatedRun(scenario);
  expect(result.completed).toBe(0);
  expect(
    journal.attempts.filter((a) => a.action === 'delete-comment').at(-1)?.state,
  ).toBe('ambiguous');
});
