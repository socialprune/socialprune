import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SQLiteStore } from '../../cli/src/workspace/sqlite-store.ts';
import { createProfile } from '../../cli/src/browser/profile.ts';
import { fakeX } from '../../cli/e2e/fake-x/server.ts';
import { fixtureWorkspace, FIXTURE } from '../../cli/e2e/fake-x/fixture.ts';
import { fakeInstagram } from '../../cli/e2e/fake-instagram/server.ts';
import { instagramFixture } from '../../cli/e2e/fake-instagram/fixture.ts';
import { launch, call } from './helpers.ts';
import { assertNoRemainingProcesses } from '../test/windows.ts';
import type { RunView } from '../src/protocol.ts';

async function generated(platform: 'x' | 'instagram', limit = false) {
  const ig = await instagramFixture(2);
  const initial = platform === 'x' ? fixtureWorkspace() : ig.workspace;
  // These rows are ordinary generated posts here. Replies/quotes deliberately
  // block deletion until their anonymous originals are settled in the CLI.
  if (platform === 'x')
    for (const item of initial.items)
      if (item.kind === 'reply' || item.kind === 'quote') item.kind = 'post';
  const fake =
    platform === 'x' ? await fakeX(4631) : await fakeInstagram(4636, ig.items);
  if ('setVariant' in fake && limit) fake.setVariant('side-429');
  const app = await launch('probe', false, async (data) => {
    await mkdir(join(data, 'workspace'), { recursive: true });
    const store = await SQLiteStore.open(
      join(data, 'workspace/socialprune.sqlite'),
      { initial },
    );
    await store.close();
    await createProfile(join(data, 'profiles', platform), platform);
  });
  const monitor = app.page.getByTestId('desktop-monitor');
  const view = async (): Promise<RunView> => {
    const reply = await call(app, {
      type: 'runView',
      requestId: crypto.randomUUID(),
    });
    if (reply.type !== 'runView') throw new Error(JSON.stringify(reply));
    return reply.view;
  };
  const control = (type: string) =>
    app.application.evaluate(async (_electron, command) => {
      const probe = Reflect.get(globalThis, 'desktopProbe') as {
        engine: {
          child: {
            once(event: string, receive: (value: unknown) => void): void;
            postMessage(value: unknown): void;
          };
        };
      };
      return new Promise<unknown>((resolve) => {
        probe.engine.child.once('message', resolve);
        probe.engine.child.postMessage(command);
      });
    }, type);
  let browserPids: number[] = [];
  return {
    app,
    fake,
    monitor,
    view,
    control,
    async phase(expected: RunView['phase']) {
      try {
        await expect(monitor).toHaveAttribute('data-phase', expected, {
          timeout: 30_000,
        });
      } catch (error) {
        console.log(
          JSON.stringify({
            proof: 'failed-run-diagnosis',
            expected,
            view: await view(),
            requests: fake.requests,
            browser: await control('runProbe'),
          }),
        );
        throw error;
      }
    },
    async prepare() {
      const requestsBefore = fake.requests.length;
      await app.page
        .getByRole('button', { name: 'Run monitor', exact: true })
        .click();
      if (platform === 'x')
        await app.page
          .getByRole('combobox')
          .filter({ has: app.page.locator('option[value="delete"]') })
          .selectOption('delete');
      await app.page
        .getByRole('button', { name: 'Preview run', exact: true })
        .click();
      await app.page
        .getByRole('button', { name: 'Open run monitor', exact: true })
        .click();
      await expect(monitor).toHaveAttribute('data-phase', 'awaiting-warning');
      expect(fake.requests).toHaveLength(requestsBefore);
      await expect(
        monitor.getByRole('button', { name: 'Start', exact: true }),
      ).toBeDisabled();
    },
    async start() {
      await monitor.getByRole('checkbox').check();
      await monitor.getByRole('button', { name: 'Start', exact: true }).click();
    },
    async close() {
      try {
        if (app.process.exitCode === null)
          browserPids = ((await control('runProbe')) as { pids: number[] })
            .pids;
        await app.close();
        await assertNoRemainingProcesses(browserPids);
      } finally {
        await fake.close();
      }
    },
    async rememberBrowsers() {
      browserPids = ((await control('runProbe')) as { pids: number[] }).pids;
    },
  };
}

test('packaged X monitor watches both canaries, pauses, resumes, completes the full plan and passes window switches', async () => {
  const h = await generated('x');
  try {
    await h.prepare();
    await h.start();
    await h.phase('awaiting-continue');
    await h.monitor
      .getByRole('button', { name: 'Pause between steps' })
      .click();
    await h.monitor
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await expect(h.monitor).toHaveAttribute('data-phase', 'paused');
    const sent = h.fake.requests.filter(
      (request) => request.method === 'POST',
    ).length;
    expect(sent).toBe(1);
    await h.monitor
      .getByRole('button', { name: 'Resume with account checks' })
      .click();
    await h.phase('awaiting-continue');
    await h.monitor
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await h.phase('ended');
    expect(await h.view()).toMatchObject({
      phase: 'ended',
      progress: { completed: 4 },
      end: { reason: 'done' },
      profile: { readback: { outcome: 'unchanged' } },
    });
    const db = await SQLiteStore.open(
      join(h.app.data, 'workspace/socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      const journal = await db.browserJournal();
      expect(journal.attempts.map((attempt) => attempt.state)).toEqual(
        FIXTURE.expected.successStates,
      );
    } finally {
      await db.close();
    }
    const probe = (await h.control('runProbe')) as {
      commandLines: string[][];
      openPages: number;
    };
    expect(probe.openPages).toBeGreaterThan(0);
    const bounds = await h.app.application.evaluate(
      ({ BrowserWindow, screen }) => ({
        actual: BrowserWindow.getAllWindows()[0]!.getBounds(),
        area: screen.getDisplayMatching(
          BrowserWindow.getAllWindows()[0]!.getBounds(),
        ).workArea,
      }),
    );
    if (bounds.area.width >= 1280) {
      expect(bounds.actual).toEqual({
        ...bounds.area,
        width: Math.floor(bounds.area.width / 2),
      });
      expect(probe.commandLines[0]).toEqual(
        expect.arrayContaining([
          `--window-position=${bounds.area.x + Math.floor(bounds.area.width / 2)},${bounds.area.y}`,
          `--window-size=${Math.ceil(bounds.area.width / 2)},${bounds.area.height}`,
        ]),
      );
    } else
      expect(
        probe.commandLines[0]!.some((arg) =>
          arg.startsWith('--window-position='),
        ),
      ).toBe(false);
  } finally {
    await h.close();
  }
});

test('packaged Instagram canary requires Continue and Matches and the next full run completes', async () => {
  const h = await generated('instagram');
  try {
    await h.prepare();
    await h.start();
    for (let index = 0; index < 2; index++) {
      await h.phase('awaiting-continue');
      await h.monitor
        .getByRole('button', { name: 'Continue', exact: true })
        .click();
    }
    await expect(h.monitor).toHaveAttribute('data-phase', 'canary-review');
    await h.monitor
      .getByRole('button', { name: 'Matches', exact: true })
      .click();
    await expect(h.monitor).toHaveAttribute('data-phase', 'ended');
    expect(await h.view()).toMatchObject({
      phase: 'ended',
      progress: { completed: 2 },
      end: { reason: 'canary' },
    });
    await h.control('closeBrowsers');
    await h.prepare();
    await h.start();
    await h.phase('ended');
    expect(await h.view()).toMatchObject({
      phase: 'ended',
      canary: false,
      end: { reason: 'done' },
    });
  } finally {
    await h.close();
  }
});

test('closing an active window can cancel, then confirm Stop and await engine settlement before exit', async () => {
  const h = await generated('x');
  try {
    await h.prepare();
    await h.start();
    await h.phase('awaiting-continue');
    await h.app.application.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = () =>
        Promise.resolve({
          response: 1,
          checkboxChecked: false,
        });
      BrowserWindow.getAllWindows()[0]!.close();
    });
    expect(h.app.process.exitCode).toBeNull();
    await expect(h.monitor).toHaveAttribute('data-phase', 'awaiting-continue');
    await h.rememberBrowsers();
    await h.app.application.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = () =>
        Promise.resolve({
          response: 0,
          checkboxChecked: false,
        });
      BrowserWindow.getAllWindows()[0]!.close();
    });
    await expect
      .poll(() => h.app.process.exitCode, { timeout: 30_000 })
      .toBe(0);
    const store = await SQLiteStore.open(
      join(h.app.data, 'workspace/socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      const journal = await store.browserJournal();
      expect(journal.runs[0]).toMatchObject({ endReason: 'stopped-by-person' });
      expect(journal.runs[0]!.endedAt).not.toBeNull();
      expect(journal.runs[0]!.profileReport).not.toBeNull();
      expect(journal.attempts.map((attempt) => attempt.state)).toEqual(
        FIXTURE.expected.oneSuccessStates,
      );
    } finally {
      await store.close();
    }
  } finally {
    await h.close();
  }
});

test('packaged HTTP 429 stops and shows the closed Stop detail sentence', async () => {
  const h = await generated('instagram', true);
  try {
    await h.prepare();
    await h.start();
    await h.phase('ended');
    expect(await h.view()).toMatchObject({
      phase: 'ended',
      end: { detail: 'http-429' },
    });
    await expect(h.monitor.getByTestId('run-end')).toHaveText(
      'The platform limited a request with HTTP 429. The run stopped.',
    );
  } finally {
    await h.close();
  }
});

for (const phase of [
  'awaiting-warning',
  'awaiting-continue',
  'paused',
] as const)
  test(`Stop from ${phase} ends the packaged run without a following deletion`, async () => {
    const h = await generated('x');
    try {
      await h.prepare();
      if (phase !== 'awaiting-warning') {
        await h.start();
        await h.phase('awaiting-continue');
        if (phase === 'paused') {
          await h.monitor
            .getByRole('button', { name: 'Pause between steps' })
            .click();
          await h.monitor
            .getByRole('button', { name: 'Continue', exact: true })
            .click();
          await expect(h.monitor).toHaveAttribute('data-phase', 'paused');
        }
      }
      const sent = h.fake.requests.filter(
        (request) => request.method === 'POST',
      ).length;
      await h.monitor
        .getByRole('button', { name: 'Stop', exact: true })
        .click();
      await expect(h.monitor).toHaveAttribute('data-phase', 'ended');
      expect(await h.view()).toMatchObject({
        phase: 'ended',
        end: { reason: 'stopped-by-person' },
      });
      expect(
        h.fake.requests.filter((request) => request.method === 'POST'),
      ).toHaveLength(sent);
    } finally {
      await h.close();
    }
  });
