import { mkdtemp, rm, mkdir, readdir, readFile } from 'node:fs/promises';
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
import { DatabaseSync } from 'node:sqlite';

async function generatedRun(
  scenario:
    | DeleteCase
    | 'extension-change'
    | 'archive-likes-lost'
    | 'archive-replies-lost'
    | 'restored-tabs'
    | 'foreign-tab',
  afterCanary = false,
  archiveMixed = false,
) {
  const root = await mkdtemp(join(tmpdir(), 'sp-d10-browser-'));
  const workspace = await instagramDeleteFixture(
      archiveMixed ? 5 : afterCanary ? 3 : 2,
    ),
    account = workspace.items[0]!.account.key;
  if (archiveMixed) {
    delete workspace.instagramContext![0]!.likes;
    delete workspace.instagramContext![1]!.replies;
    delete workspace.instagramContext![2]!.likes;
    delete workspace.instagramContext![2]!.replies;
    workspace.instagramContext![3]!.replies = {
      entries: [],
      capped: true,
      moreCount: 1,
    };
  }
  const store = await SQLiteStore.open(join(root, 'socialprune.sqlite'), {
    initial: workspace,
  });
  const profile = join(root, 'profile');
  await createProfile(profile, 'instagram');
  const server = await fakeInstagram(4871, workspace.items);
  server.deletionCase(
    scenario === 'extension-change' ||
      scenario.startsWith('archive-') ||
      scenario === 'restored-tabs' ||
      scenario === 'foreign-tab'
      ? 'success'
      : (scenario as DeleteCase),
  );
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
        launch: async (directory, executablePath) => {
          // The run's own executable, as production uses it. The headless
          // shell Playwright picks without one has no shared browser windows,
          // so the run-window rule would refuse every background page.
          const context = await chromium.launchPersistentContext(directory, {
            executablePath,
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
              // A tab the run did not open, appearing after Start and before
              // any comment page opens.
              if (scenario === 'foreign-tab') await context.newPage();
              await page
                .getByRole('button', { name: 'Continue', exact: true })
                .click({ timeout: 12000 });
            } catch {
              /* Refused canaries and ended contexts expose no Continue. */
            }
          };
          // Restored tabs inherited at launch, as a reopened profile shows.
          if (scenario === 'restored-tabs')
            for (let index = 0; index < 3; index++)
              await (
                await context.newPage()
              ).setContent('<title>Generated restored tab</title>');
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
          if (scenario.startsWith('archive-')) {
            // Test-only corruption stands in for a changed current workspace.
            // Normal stores forbid removing an archived observation.
            const db = new DatabaseSync(join(root, 'socialprune.sqlite'));
            try {
              const trigger = db
                .prepare(
                  "SELECT sql FROM sqlite_master WHERE name='instagram_context_no_update'",
                )
                .get()!.sql;
              db.exec('DROP TRIGGER instagram_context_no_update');
              db.prepare(
                'UPDATE instagram_context SET data=json_remove(data,?) WHERE item_id=?',
              ).run(
                scenario === 'archive-likes-lost' ? '$.likes' : '$.replies',
                row.item.id,
              );
              db.exec(String(trigger));
            } finally {
              db.close();
            }
          }
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
    const reports = join(root, 'context', 'instagram');
    const reportFile = (await readdir(reports))
      .filter((name) => name.startsWith('delete-'))
      .sort()
      .at(-1);
    return {
      result,
      journal,
      report: reportFile
        ? (JSON.parse(await readFile(join(reports, reportFile), 'utf8')) as {
            stop: string | null;
            warning: string | null;
            pages: Record<string, unknown> | null;
          })
        : undefined,
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
test('DEL-TABS restored tabs inherited at launch close at startup and the tab inventory passes at the step boundary', async () => {
  const { result, attempts, report } = await generatedRun('restored-tabs');
  expect(result).toMatchObject({
    completed: 1,
    endReason: 'canary',
    code: null,
  });
  expect(attempts).toEqual(['191919191919191919']);
  expect(report?.pages).toMatchObject({
    remainingNonOwned: 0,
    targetFailure: null,
    unexpectedOpened: 0,
  });
  // The launch page and three restored tabs; the startup audit and one step
  // boundary before the watched comment opens.
  expect(report?.pages?.['startupClosed']).toBeGreaterThanOrEqual(4);
  expect(report?.pages?.['targetChecks']).toBeGreaterThanOrEqual(2);
});
test('DEL-TABS a tab the run did not open stops before any deletion request and is no warning', async () => {
  const { result, attempts, report, warning, nextPlan } =
    await generatedRun('foreign-tab');
  expect(result.completed).toBe(0);
  expect(result.code).not.toBeNull();
  expect(attempts).toEqual([]);
  expect(report?.pages?.['unexpectedOpened']).toBe(1);
  expect(report?.warning).toBeNull();
  expect(warning).toBeNull();
  // No attempt was sent, so the next plan is still the same watched canary.
  expect(nextPlan.canary).toBe(true);
});
test('DEL-ARCHIV-1 headless generated browser sends only an archived capped comment and leaves all unread comments untouched', async () => {
  const { result, journal, attempts, nextPlan } = await generatedRun(
    'success',
    false,
    true,
  );
  expect(result).toMatchObject({ completed: 1, endReason: 'canary' });
  expect(attempts).toEqual(['191919191919191922']);
  expect(
    journal.attempts
      .filter((attempt) => attempt.action === 'delete-comment')
      .map((attempt) => attempt.itemId),
  ).toEqual(['instagram:generated-3', 'instagram:generated-3']);
  expect(nextPlan.rows.map((row) => row.item.id)).toEqual([
    'instagram:generated-4',
  ]);
  expect(nextPlan.archiveMissing).toEqual({ likes: 1, replies: 1, both: 1 });
});
test.each(['archive-likes-lost', 'archive-replies-lost'] as const)(
  'DEL-ARCHIV-1 %s after planning refuses the final click against current workspace',
  async (scenario) => {
    const { result, journal, attempts } = await generatedRun(scenario);
    expect(result).toMatchObject({ completed: 0, code: 'RUN_STOPPED' });
    expect(attempts).toEqual([]);
    expect(
      journal.attempts
        .filter((attempt) => attempt.action === 'delete-comment')
        .map((attempt) => attempt.state),
    ).toEqual(['sending', 'failed']);
  },
);
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
