import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { createEngine } from './facade.ts';
import { productionDependencies } from './dependencies.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { createProfile } from '../browser/profile.ts';
import type { RunView } from '@socialprune/core/workspace/desktop-protocol';

test('engine settled run keeps its registered exact browser ownership until browser close, and engine shutdown retains that closer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-window-lifecycle-'));
  await mkdir(join(root, 'workspace'));
  const store = await SQLiteStore.open(
    join(root, 'workspace/socialprune.sqlite'),
    { initial: fixtureWorkspace(['1001']) },
  );
  await store.close();
  await createProfile(join(root, 'profiles/x'));
  let closed!: () => void;
  const closure = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const close = vi.fn(() => {
    closed();
    return Promise.resolve();
  });
  const id = crypto.randomUUID();
  const move = vi.fn().mockResolvedValue(undefined);
  const engine = await createEngine(
    { dataFolder: root },
    {
      ...productionDependencies,
      browser: () => Promise.resolve('generated'),
      delete: (options) => {
        options.session!.browser(close, closure);
        options.session!.ownedWindow!({
          closed: closure,
          current: () =>
            Promise.resolve({
              id,
              bounds: { x: 5000, y: 4000, width: 600, height: 400 },
            }),
          move,
        });
        return Promise.reject(
          new Error('Generated task settled while browser stays open'),
        );
      },
    },
  );
  let view: RunView = { phase: 'idle', version: 0 };
  engine.onRunView((value) => {
    view = value;
  });
  try {
    expect(await engine.window({ type: 'current' })).toEqual({
      type: 'window',
      value: null,
    });
    const plan = await engine.request({
      type: 'planRun',
      requestId: 'plan',
      platform: 'x',
      mode: 'delete',
      accountKey: FIXTURE.account.key,
    });
    if (plan.type !== 'runPlanned') throw new Error('NO_PLAN');
    await engine.request({
      type: 'startRun',
      requestId: 'prepare',
      browser: 'edge',
      planHash: plan.plan.planHash,
    });
    for (const action of ['acknowledge-warning', 'start'] as const) {
      const current = view as RunView;
      if (current.phase === 'idle') throw new Error('NO_RUN');
      await engine.request({
        type: 'runAction',
        requestId: action,
        runId: current.runId,
        version: current.version,
        action,
      });
    }
    await expect.poll(() => view.phase).toBe('ended');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await engine.window({ type: 'current' })).toMatchObject({
      type: 'window',
      value: { id },
    });
    expect(close).not.toHaveBeenCalled();
    await engine.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(await engine.window({ type: 'current' })).toEqual({
      type: 'unavailable',
    });
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
