import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dist } from '../packaging/paths.ts';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SQLiteStore } from '../../cli/src/workspace/sqlite-store.ts';
import { createProfile } from '../../cli/src/browser/profile.ts';
import { fakeX } from '../../cli/e2e/fake-x/server.ts';
import { fixtureWorkspace, FIXTURE } from '../../cli/e2e/fake-x/fixture.ts';
import { launch, call } from './helpers.ts';
import { startForegroundWatch } from './foreground-watch.ts';

test('runner-owned generated platform window recovers without activation, visible neighbor stays and ownership survives ended until close', async () => {
  const receiptPath = join(dist, `release-display-steps-${randomUUID()}.json`);
  const steps: { name: string; state: string; elapsedMs: number }[] = [];
  const stepStarted = performance.now();
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const record = async (state: string) => {
      const row = {
        name,
        state,
        elapsedMs: Math.ceil(performance.now() - stepStarted),
      };
      steps.push(row);
      await writeFile(receiptPath, JSON.stringify({ steps }));
      console.log('DISPLAY_STEP', JSON.stringify(row));
    };
    await record('started');
    try {
      const result = await test.step(name, run);
      await record('returned');
      return result;
    } catch (error) {
      await record('failed');
      throw error;
    }
  };
  const fake = await step('fake-start', () => fakeX(4771));
  const app = await step('app-launch', () =>
    launch('probe', false, undefined, async (data) => {
      const root = join(data, 'display-producer');
      await mkdir(join(root, 'workspace'), { recursive: true });
      const initial = fixtureWorkspace();
      for (const item of initial.items)
        if (item.kind === 'reply' || item.kind === 'quote') item.kind = 'post';
      const store = await SQLiteStore.open(
        join(root, 'workspace/socialprune.sqlite'),
        { initial },
      );
      await store.close();
      await createProfile(join(root, 'profiles/x'), 'x');
      return root;
    }),
  );
  const owner = () =>
    app.application.evaluate(async () => {
      const p = Reflect.get(globalThis, 'desktopProbe') as {
        engine: { platformWindow: { current(): Promise<unknown> } };
      };
      return p.engine.platformWindow.current();
    }) as Promise<{
      id: string;
      bounds: { x: number; y: number; width: number; height: number };
    } | null>;
  const control = (command: { type: string; bounds?: unknown }) =>
    step(command.type, () =>
      app.application.evaluate(async (_electron, value) => {
        const p = Reflect.get(globalThis, 'desktopProbe') as {
          displayControl(command: unknown): Promise<unknown>;
        };
        return p.displayControl(value);
      }, command),
    );
  let watching: Awaited<ReturnType<typeof startForegroundWatch>> | undefined;
  const timeline: unknown[] = [];
  const started = performance.now();
  const mark = (event: string, value?: unknown) =>
    timeline.push({
      event,
      elapsedMs: Math.ceil(performance.now() - started),
      value,
    });
  let outcome = 'failed';
  try {
    await app.application.evaluate(() => {
      const probe = Reflect.get(globalThis, 'desktopProbe') as {
        engine: {
          platformWindow: {
            current(): Promise<unknown>;
            move(...args: unknown[]): Promise<void>;
          };
        };
      };
      const traces: unknown[] = [];
      Reflect.set(globalThis, 'displayBoundaryTrace', traces);
      for (const name of ['current', 'move'] as const) {
        const original: (...args: unknown[]) => Promise<unknown> =
          probe.engine.platformWindow[name].bind(probe.engine.platformWindow);
        const owner = probe.engine.platformWindow as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        owner[name] = async (...args) => {
          const started = performance.now();
          traces.push({ event: name + '-start', at: started, args });
          try {
            const reply = await original(...args);
            traces.push({
              event: name + '-returned',
              at: performance.now(),
              elapsedMs: performance.now() - started,
              reply,
            });
            return reply;
          } catch (error) {
            traces.push({
              event: name + '-failed',
              at: performance.now(),
              elapsedMs: performance.now() - started,
              error: String(error),
            });
            throw error;
          }
        };
      }
      const child = (
        probe.engine as unknown as {
          child: {
            on(event: string, callback: (value: unknown) => void): void;
          };
        }
      ).child;
      child.on('message', (value) =>
        traces.push({ event: 'test-engine-message', value }),
      );
    });
    expect(await owner()).toBeNull();
    const plan = await call(app, {
      type: 'planRun',
      requestId: crypto.randomUUID(),
      platform: 'x',
      mode: 'delete',
      accountKey: FIXTURE.account.key,
    });
    expect(plan.type).toBe('runPlanned');
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    await call(app, {
      type: 'startRun',
      requestId: crypto.randomUUID(),
      planHash: plan.plan.planHash,
      browser: 'edge',
    });
    const view = await call(app, {
      type: 'runView',
      requestId: crypto.randomUUID(),
    });
    if (view.type !== 'runView' || view.view.phase === 'idle')
      throw new Error('NO_RUN');
    const action = async (value: 'acknowledge-warning' | 'start' | 'stop') => {
      const r = await call(app, {
        type: 'runView',
        requestId: crypto.randomUUID(),
      });
      if (r.type !== 'runView' || r.view.phase === 'idle')
        throw new Error('NO_RUN');
      return call(app, {
        type: 'runAction',
        requestId: crypto.randomUUID(),
        runId: r.view.runId,
        version: r.view.version,
        action: value,
      });
    };
    await step('acknowledge-warning', () => action('acknowledge-warning'));
    await step('run-start', () => action('start'));
    // The engine deliberately refuses an active launch until its exact-window
    // capability is registered. Retry that initial state, not later read errors.
    await step('owner-ready', () =>
      expect
        .poll(
          async () => {
            try {
              return await owner();
            } catch (error) {
              if (/OWNED_WINDOW_UNAVAILABLE/.test(String(error))) return null;
              throw error;
            }
          },
          { timeout: 30000 },
        )
        .not.toBeNull(),
    );
    const first = await step('owner-read', owner);
    mark('owner', first);
    if (!first) throw new Error('NO_OWNER');
    // Ownership precedes startup checks. This display scenario stops at the
    // read-only canary checkpoint rather than racing those unfinished checks.
    await step('canary-ready', () =>
      expect
        .poll(async () => {
          const reply = await call(app, {
            type: 'runView',
            requestId: crypto.randomUUID(),
          });
          return reply.type === 'runView' ? reply.view.phase : '';
        })
        .toBe('awaiting-continue'),
    );
    await step('run-stop', () => action('stop'));
    await step('run-ended', () =>
      expect
        .poll(async () => {
          const r = await call(app, {
            type: 'runView',
            requestId: crypto.randomUUID(),
          });
          return r.type === 'runView' ? r.view.phase : '';
        })
        .toBe('ended'),
    );
    expect((await owner())?.id).toBe(first.id);
    mark('ended', await owner());
    const areas = await app.application.evaluate(({ screen }) =>
      screen.getAllDisplays().map((d) => d.workArea),
    );
    const off = {
      x: Math.max(...areas.map((a) => a.x + a.width)) + 1000,
      y: Math.max(...areas.map((a) => a.y + a.height)) + 1000,
      width: 600,
      height: 400,
    };
    expect(
      await control({ type: 'displayPosition', bounds: off }),
    ).toMatchObject({ positioned: true });
    await expect.poll(async () => (await owner())?.bounds.x).toBe(off.x);
    mark('offscreen', { target: await owner(), areas });
    await step('neighbor-create', () =>
      app.application.evaluate(({ BrowserWindow }) => {
        const neighbor = new BrowserWindow({
          width: 350,
          height: 250,
          show: true,
          title: 'Generated neighbor',
          webPreferences: { sandbox: true, nodeIntegration: false },
        });
        Reflect.set(globalThis, 'displayNeighbor', neighbor);
        neighbor.focus();
      }),
    );
    const neighborBefore = await step('neighbor-before', () =>
      app.application.evaluate(() => {
        const w = Reflect.get(
          globalThis,
          'displayNeighbor',
        ) as Electron.BrowserWindow;
        return { bounds: w.getBounds(), focused: w.isFocused() };
      }),
    );
    watching = await step('foreground-start', () =>
      startForegroundWatch(app.data),
    );
    mark('foreground-ready', {
      readyMs: watching.readyMs,
      signal: watching.signal,
      target: await owner(),
    });
    await step('recovery-event', () =>
      app.application.evaluate(({ screen }) => {
        screen.emit('display-metrics-changed');
      }),
    );
    await step('recovery-geometry', () =>
      expect
        .poll(async () => {
          const value = await owner();
          mark('recovery-poll', value);
          return (
            value &&
            areas.some(
              (a) =>
                value.bounds.x < a.x + a.width &&
                value.bounds.x + value.bounds.width > a.x &&
                value.bounds.y < a.y + a.height &&
                value.bounds.y + value.bounds.height > a.y,
            )
          );
        })
        .toBe(true),
    );
    const observed = await step('foreground-stop', () => watching!.stop());
    watching = undefined;
    expect(observed.changed).toBe(false);
    expect(observed.samples).toBeGreaterThan(0);
    expect(observed.final).toBe(observed.handle);
    expect(
      await step('neighbor-after', () =>
        app.application.evaluate(() => {
          const w = Reflect.get(
            globalThis,
            'displayNeighbor',
          ) as Electron.BrowserWindow;
          return { bounds: w.getBounds(), focused: w.isFocused() };
        }),
      ),
    ).toEqual(neighborBefore);
    const visible = {
      x: areas[0]!.x - 599,
      y: areas[0]!.y,
      width: 600,
      height: 400,
    };
    await control({ type: 'displayPosition', bounds: visible });
    await expect.poll(async () => (await owner())?.bounds).toEqual(visible);
    await app.application.evaluate(({ screen }) => {
      screen.emit('display-removed');
    });
    await step('monitor-navigation', () =>
      app.page
        .getByRole('button', { name: 'Run monitor', exact: true })
        .click(),
    );
    expect((await owner())?.bounds).toEqual(visible);
    await control({ type: 'displayClose' });
    await step('closed-owner', () => expect.poll(owner).toBeNull());
    expect(app.errors).toEqual([]);
    outcome = 'passed';
  } finally {
    await step('finally-foreground', async () => {
      await watching?.stop();
    });
    mark(
      'final-owner',
      await step('finally-owner', () =>
        owner().catch((error: unknown) => ({ failure: String(error) })),
      ),
    );
    const log = await readFile(
      join(app.selectedData, 'logs', 'desktop.ndjson'),
      'utf8',
    ).catch(() => '');
    const receipt = {
      outcome,
      timeline,
      log,
      currentAreas: await app.application.evaluate(({ screen }) =>
        screen.getAllDisplays().map((display) => display.workArea),
      ),
      boundary: await app.application.evaluate(
        () => Reflect.get(globalThis, 'displayBoundaryTrace') as unknown,
      ),
    };
    await writeFile(
      join(dist, `release-display-producer-${randomUUID()}.json`),
      JSON.stringify(receipt),
    );
    console.log('DISPLAY_PRODUCER_RECEIPT', JSON.stringify(receipt));
    await app.application
      .evaluate(() => {
        (
          Reflect.get(globalThis, 'displayNeighbor') as
            Electron.BrowserWindow | undefined
        )?.destroy();
      })
      .catch(() => {});
    await step('app-close', () => app.close());
    await step('fake-close', () => fake.close());
  }
});
