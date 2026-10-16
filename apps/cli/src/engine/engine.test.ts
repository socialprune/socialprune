import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { openEngine } from './index.ts';
import { EngineHostMessageSchema } from './host.ts';
import { DesktopReplySchema } from '@socialprune/core/workspace/desktop-protocol';
import { fileURLToPath } from 'node:url';
import { createEngine } from './facade.ts';
import { productionDependencies } from './dependencies.ts';
import { EngineReviewDispatch } from './review-dispatch.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { mkdir } from 'node:fs/promises';
import { createProfile } from '../browser/profile.ts';
import { ConfirmationState } from '../browser/confirmation-state.ts';
import type { RunView } from '@socialprune/core/workspace/desktop-protocol';

test('engine opens a generated workspace, uses the review handlers and closes its store', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'sp-engine-'));
  const engine = await openEngine({ dataFolder });
  try {
    const reply = await engine.request({
      type: 'open',
      requestId: 'generated-open',
      workspaceId: 'local',
    });
    expect(DesktopReplySchema.parse(reply)).toMatchObject({
      type: 'reviewReply',
      requestId: 'generated-open',
      replies: [{ type: 'opened' }],
    });
    const folder = await engine.request({
      type: 'dataFolderInfo',
      requestId: 'generated-folder',
    });
    expect(folder).toMatchObject({
      type: 'dataFolderInfo',
      folder: { path: dataFolder, storeBuild: false },
    });
  } finally {
    await engine.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});

test('main-only methods and renderer paths are rejected at the engine boundary with closed failures', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'sp-engine-boundary-'));
  const engine = await openEngine({ dataFolder });
  try {
    for (const request of [
      {
        type: 'openLink',
        requestId: 'generated-link',
        link: { kind: 'guide-report' },
      },
      { type: 'dataFolderOpen', requestId: 'generated-folder' },
      {
        type: 'importExport',
        requestId: 'generated-path',
        path: 'generated-private-decoy',
      },
    ]) {
      const result = await engine.request(
        request as Parameters<typeof engine.request>[0],
      );
      expect(result).toEqual({
        type: 'desktopFailed',
        requestId: request.requestId,
        code: 'INVALID_ARGUMENTS',
      });
      expect(JSON.stringify(result)).not.toContain('generated-private-decoy');
    }
    expect(
      EngineHostMessageSchema.safeParse({
        request: { type: 'backupRestore', requestId: 'generated' },
        selection: { type: 'backupExport', path: 'generated' },
      }).success,
    ).toBe(false);
    expect(
      await engine.handleHost({
        request: { type: 'importExport', requestId: 'cancelled' },
        selection: { type: 'importExport', paths: null },
      }),
    ).toEqual({
      type: 'exportImported',
      requestId: 'cancelled',
      result: { status: 'cancelled' },
    });
  } finally {
    await engine.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});

test('typed host dialog selections import, export and restore using the existing services', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'sp-engine-files-'));
  const engine = await openEngine({ dataFolder });
  const source = fileURLToPath(
    new URL(
      '../../../../fixtures/synthetic/x/current-minimal/',
      import.meta.url,
    ),
  );
  const metadata = JSON.parse(
    await readFile(join(source, 'expected.json'), 'utf8'),
  ) as { items: unknown[] };
  try {
    expect(
      await engine.handleHost({
        request: { type: 'importExport', requestId: 'import' },
        selection: { type: 'importExport', paths: [source] },
      }),
    ).toMatchObject({
      type: 'exportImported',
      result: { status: 'imported', items: metadata.items.length },
    });
    const backup = join(dataFolder, 'generated-backup.json');
    const exported = await engine.handleHost({
      request: { type: 'backupExport', requestId: 'export' },
      selection: { type: 'backupExport', path: backup },
    });
    expect(exported).toMatchObject({
      type: 'backupExported',
      result: { status: 'exported', mediaFiles: 0, mediaBytes: 0 },
    });
    if (
      exported.type === 'backupExported' &&
      exported.result.status === 'exported'
    )
      expect(exported.result.bytes).toBe((await readFile(backup)).byteLength);
    expect(
      await engine.handleHost({
        request: { type: 'backupRestore', requestId: 'restore' },
        selection: { type: 'backupRestore', path: backup },
      }),
    ).toMatchObject({
      type: 'backupRestored',
      result: { status: 'restored', items: metadata.items.length },
    });
    expect(
      await engine.request({
        type: 'detail',
        requestId: 'missing',
        itemId: 'x:generated-missing',
      }),
    ).toEqual({
      type: 'desktopFailed',
      requestId: 'missing',
      code: 'UNKNOWN_ITEM',
    });
  } finally {
    await engine.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}, 30000);

test('profile setup and forget reuse dedicated profile procedures without a loopback listener', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'sp-engine-profiles-'));
  const engine = await createEngine(
    { dataFolder },
    {
      ...productionDependencies,
      browser: () => Promise.resolve('generated-browser'),
      setup: () => Promise.resolve(),
    },
  );
  try {
    expect(
      await engine.request({
        type: 'profileSetup',
        requestId: 'setup',
        platform: 'x',
        browser: 'edge',
      }),
    ).toMatchObject({
      type: 'profileSetupResult',
      profile: { ready: true, exists: true },
    });
    expect(
      await engine.request({
        type: 'profileForget',
        requestId: 'forget',
        platform: 'x',
      }),
    ).toMatchObject({
      type: 'profileForgetResult',
      profile: { ready: false, exists: false },
    });
  } finally {
    await engine.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});

test('review decisions through the facade retain human local-review provenance', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'sp-engine-decisions-'));
  const engine = await openEngine({ dataFolder });
  const source = fileURLToPath(
    new URL(
      '../../../../fixtures/synthetic/x/current-minimal/',
      import.meta.url,
    ),
  );
  const metadata = JSON.parse(
    await readFile(join(source, 'expected.json'), 'utf8'),
  ) as { items: { id: string }[] };
  const itemId = metadata.items[0]!.id;
  try {
    await engine.handleHost({
      request: { type: 'importExport', requestId: 'import' },
      selection: { type: 'importExport', paths: [source] },
    });
    const result = await engine.request({
      type: 'decide',
      requestId: 'human-decision',
      commandId: 'generated-human-command',
      itemIds: [itemId],
      value: 'delete',
      expected: { [itemId]: 'undecided' },
    });
    expect(result.type).toBe('reviewReply');
    const detail = await engine.request({
      type: 'detail',
      requestId: 'detail',
      itemId,
    });
    if (detail.type !== 'reviewReply') throw new Error(JSON.stringify(detail));
    expect(detail.replies[0]).toMatchObject({
      type: 'itemDetail',
      events: [
        { source: { kind: 'human', via: 'local-review' }, value: 'delete' },
      ],
    });
  } finally {
    await engine.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});

test('Stop is dispatched while a slow review operation still owns the command queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-engine-stop-queue-'));
  await mkdir(join(root, 'workspace'));
  const store = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial: fixtureWorkspace(['1001']) },
  );
  await store.close();
  await createProfile(join(root, 'profiles', 'x'));
  const engine = await createEngine(
    { dataFolder: root },
    {
      ...productionDependencies,
      browser: () => Promise.resolve('generated-browser'),
    },
  );
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    const plan = await engine.request({
      type: 'planRun',
      requestId: 'plan',
      platform: 'x',
      mode: 'delete',
      accountKey: FIXTURE.account.key,
    });
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    const prepared = await engine.request({
      type: 'startRun',
      requestId: 'prepare',
      browser: 'edge',
      planHash: plan.plan.planHash,
    });
    if (prepared.type !== 'runStarted' || prepared.view.phase === 'idle')
      throw new Error(JSON.stringify(prepared));
    const spy = vi
      .spyOn(EngineReviewDispatch.prototype, 'run')
      .mockImplementation(async () => {
        entered();
        await gate;
        return [];
      });
    const slow = engine.request({ type: 'revision', requestId: 'slow' });
    await started;
    const stopped = await engine.request({
      type: 'runAction',
      requestId: 'stop',
      runId: prepared.view.runId,
      version: prepared.view.version - 1,
      action: 'stop',
    });
    expect(stopped.type).toBe('runActionResult');
    release();
    await slow;
    spy.mockRestore();
  } finally {
    release();
    vi.restoreAllMocks();
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test('a finalization throw after observing an extension has a valid incomplete fallback and releases the engine without unhandled rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-engine-fallback-'));
  await mkdir(join(root, 'workspace'));
  const store = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial: fixtureWorkspace(['1001']) },
  );
  await store.close();
  await createProfile(join(root, 'profiles', 'x'));
  let entered!: () => void;
  const attempted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const engine = await createEngine(
    { dataFolder: root },
    {
      ...productionDependencies,
      browser: () => Promise.resolve('generated-browser'),
      delete: (options) => {
        entered();
        options.session!.before(
          {
            files: new Map(),
            extensions: 1,
            extensionIds: ['generatedextensionid'],
          },
          FIXTURE.account.handle,
        );
        options.session!.finish = () => {
          throw new Error('Generated projection fault');
        };
        return Promise.reject(
          Object.assign(new Error('Generated runner fault'), {
            code: 'GeneratedUnprojectable',
            reason: 'not-a-token',
          }),
        );
      },
    },
  );
  let view: RunView = { phase: 'idle', version: 0 };
  engine.onRunView((value) => {
    view = value;
  });
  const current = (): RunView => view;
  const unhandled: unknown[] = [];
  let asserting = true;
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const plan = await engine.request({
      type: 'planRun',
      requestId: 'plan',
      platform: 'x',
      mode: 'delete',
      accountKey: FIXTURE.account.key,
    });
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    await engine.request({
      type: 'startRun',
      requestId: 'prepare',
      browser: 'edge',
      planHash: plan.plan.planHash,
    });
    for (const action of ['acknowledge-warning', 'start'] as const) {
      const live = current();
      if (live.phase === 'idle') throw new Error('No run');
      await engine.request({
        type: 'runAction',
        requestId: action,
        runId: live.runId,
        version: live.version,
        action,
      });
    }
    await attempted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    await expect.poll(() => view.phase, { timeout: 2000 }).toBe('ended');
    expect(view).toMatchObject({
      phase: 'ended',
      end: { reason: 'error', detail: 'other', cliCode: 'RUN_STOPPED' },
      profile: {
        readback: {
          outcome: 'not-completed',
          profileObserved: false,
          extensionIdsBefore: ['generatedextensionid'],
          extensionIdsAfter: ['generatedextensionid'],
          extensionIdsAdded: [],
          extensionIdsRemoved: [],
        },
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    await expect
      .poll(
        async () =>
          (
            await engine.request({
              type: 'planRun',
              requestId: 'retry-plan',
              platform: 'x',
              mode: 'delete',
              accountKey: FIXTURE.account.key,
            })
          ).type,
      )
      .toBe('runPlanned');
    asserting = false;
  } finally {
    let cleanupError: unknown;
    try {
      await engine.close();
    } catch (error) {
      cleanupError = error;
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      await rm(root, { recursive: true, force: true }).catch((error) => {
        cleanupError ??= error;
      });
    }
    if (!asserting && cleanupError)
      throw cleanupError instanceof Error
        ? cleanupError
        : new Error('Generated cleanup failed');
  }
}, 20000);

test.each(['task', 'late-close'] as const)(
  'an invalid fallback on the %s path cannot reject or strand a finished session',
  async (path) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-engine-invalid-fallback-'));
    await mkdir(join(root, 'workspace'));
    const store = await SQLiteStore.open(
      join(root, 'workspace', 'socialprune.sqlite'),
      { initial: fixtureWorkspace(['1001']) },
    );
    await store.close();
    await createProfile(join(root, 'profiles', 'x'));
    let entered!: () => void, release!: () => void, registered!: () => void;
    const attempted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const allowCloseRegistration = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closeRegistered = new Promise<void>((resolve) => {
      registered = resolve;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const original = Reflect.get<ConfirmationState, 'updateRun'>(
      ConfirmationState.prototype,
      'updateRun',
    );
    const update = vi
      .spyOn(ConfirmationState.prototype, 'updateRun')
      .mockImplementation(function (this: ConfirmationState, value) {
        if (value.phase === 'ended')
          throw new Error('Generated fallback validation fault');
        return original.call(this, value);
      });
    const close = vi.fn(() =>
      Promise.reject(new Error('Generated browser close failure')),
    );
    const engine = await createEngine(
      { dataFolder: root },
      {
        ...productionDependencies,
        browser: () => Promise.resolve('generated-browser'),
        delete: async (options) => {
          options.session!.before(
            {
              files: new Map(),
              extensions: 1,
              extensionIds: ['generatedextensionid'],
            },
            FIXTURE.account.handle,
          );
          options.session!.finish = () => {
            throw new Error('Generated projection fault');
          };
          entered();
          if (path === 'late-close') {
            await allowCloseRegistration;
            options.session!.browser(close);
            registered();
            return { runId: null, completed: 0, endReason: 'done' };
          }
          throw new Error('Generated runner fault');
        },
      },
    );
    let view: RunView = { phase: 'idle', version: 0 };
    engine.onRunView((value) => {
      view = value;
    });
    const current = (): RunView => view;
    try {
      const plan = await engine.request({
        type: 'planRun',
        requestId: 'plan',
        platform: 'x',
        mode: 'delete',
        accountKey: FIXTURE.account.key,
      });
      if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
      await engine.request({
        type: 'startRun',
        requestId: 'prepare',
        browser: 'edge',
        planHash: plan.plan.planHash,
      });
      for (const action of ['acknowledge-warning', 'start'] as const) {
        const live = current();
        if (live.phase === 'idle') throw new Error('No run');
        await engine.request({
          type: 'runAction',
          requestId: action,
          runId: live.runId,
          version: live.version,
          action,
        });
      }
      await attempted;
      if (path === 'late-close') {
        const closing = engine.close();
        release();
        await closeRegistered;
        await closing;
        expect(close).toHaveBeenCalledTimes(1);
      }
      await expect.poll(() => view.phase, { timeout: 2000 }).toBe('idle');
      expect(Object.keys(view).sort()).toEqual(['phase', 'version']);
      expect(view.version).toBeGreaterThan(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      if (path === 'task')
        await expect
          .poll(
            async () =>
              (
                await engine.request({
                  type: 'planRun',
                  requestId: 'retry',
                  platform: 'x',
                  mode: 'delete',
                  accountKey: FIXTURE.account.key,
                })
              ).type,
          )
          .toBe('runPlanned');
    } finally {
      release();
      try {
        await engine.close();
      } finally {
        update.mockRestore();
        process.removeListener('unhandledRejection', onUnhandled);
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  20000,
);
