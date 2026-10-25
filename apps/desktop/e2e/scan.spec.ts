import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { scanEndpoint } from './scan-endpoint.ts';
import { scanWorkspace } from '../../cli/src/engine/test/scan-workspace.ts';
import { SQLiteStore } from '../../cli/src/workspace/sqlite-store.ts';
import { call, launch } from './helpers.ts';
import {
  assertNoOwnedNetwork,
  watchNetwork,
} from '../packaging/network-check.ts';
import { dist } from '../packaging/paths.ts';
import { windowsQuery } from '../packaging/windows-query.ts';
import { DesktopRequestSchema } from '@socialprune/core/workspace/desktop-protocol';
import { assertScanNetwork } from './scan-network.ts';
import { managedDataFile } from '../src/main/data-removal.ts';

test('C5 network controls reject main, renderer, foreign peer and out-of-run traffic', () => {
  expect(managedDataFile('workspace/suggestion-source.json')).toBe(true);
  expect(managedDataFile('workspace/generated.key')).toBe(false);
  const input = {
    observation: {
      ticks: 1,
      observed: [],
      violations: ['connection|30|2|10001|state=5'],
    },
    enginePid: 30,
    peers: new Set([10001]),
    harnessSockets: new Set<string>(),
    requireEngineConnection: true,
  };
  expect(() => assertScanNetwork(input)).not.toThrow();
  for (const line of [
    'connection|10|2|10001|state=5',
    'connection|20|2|10001|state=5',
    'connection|30|2|10002|state=5',
    'listener|30|2|10001|state=2',
    'udp|30|2|10001|state=0',
  ])
    expect(() =>
      assertScanNetwork({
        ...input,
        observation: { ...input.observation, violations: [line] },
      }),
    ).toThrow('SCAN_NETWORK_OUTSIDE_SCOPE');
  expect(() => assertScanNetwork({ ...input, peers: new Set() })).toThrow(
    'SCAN_NETWORK_OUTSIDE_SCOPE',
  );
  expect(() =>
    assertScanNetwork({
      ...input,
      observation: { ...input.observation, ticks: 0 },
    }),
  ).toThrow('SCAN_NETWORK_OBSERVATION_MISSING');
});

test('C5 packaged error bodies never enter the renderer, desktop log, store or backup', async () => {
  const fake = await scanEndpoint();
  const app = await launch('test', false, async (data) => {
    await mkdir(join(data, 'workspace'), { recursive: true });
    const db = await SQLiteStore.open(
      join(data, 'workspace', 'socialprune.sqlite'),
      { initial: scanWorkspace(1) },
    );
    await db.close();
    await writeFile(join(data, 'generated.key'), 'generated-key-canary\n');
  });
  try {
    const send = (value: object) =>
      call(
        app,
        DesktopRequestSchema.parse({
          requestId: crypto.randomUUID(),
          ...value,
        }),
      );
    await app.application.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = () =>
          Promise.resolve({
            canceled: false,
            filePaths: [path],
          });
      },
      join(app.data, 'generated.key'),
    );
    await send({ type: 'scanKey' });
    await send({
      type: 'scanSource',
      baseUrl: fake.origin + '/v1',
      model: 'generated-model',
      entriesPerRequest: 25,
      profile: 'openai-compatible',
    });
    await send({ type: 'scanCheck' });
    const plan = await send({ type: 'scanPlan', accountKey: 'x:contract' });
    if (plan.type !== 'scanPlan') throw new Error('PLAN_MISSING');
    fake.setHostile(true);
    await send({
      type: 'scanStart',
      planHash: plan.plan.planHash,
      origin: fake.origin,
      answeringModel: 'generated-model',
      agreed: true,
      resume: false,
    });
    await expect
      .poll(() => send({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stopCode: 'ENDPOINT_UNAUTHORIZED', stored: 0 },
      });
    const output = await app.page.getByTestId('desktop-scan').textContent();
    const log = await readFile(
      join(app.data, 'logs', 'desktop.ndjson'),
      'utf8',
    );
    expect(output + log).not.toMatch(
      /generated-key-canary|Generated packaged scan note|"authorization"|Bearer/,
    );
    const db = await readFile(
      join(app.data, 'workspace', 'socialprune.sqlite'),
    );
    expect(db.includes(Buffer.from('generated-key-canary'))).toBe(false);
    const backup = join(app.data, 'generated-backup.json');
    await app.application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () =>
        Promise.resolve({
          canceled: false,
          filePath: path,
        });
    }, backup);
    expect(await send({ type: 'backupExport' })).toMatchObject({
      type: 'backupExported',
      result: { status: 'exported' },
    });
    const saved = await readFile(backup, 'utf8');
    expect(saved).not.toMatch(/generated-key-canary|"authorization"|Bearer/);
  } finally {
    await app.close();
    await fake.close();
  }
});

test('C5 packaged redirect refuses a second origin and has no engine traffic before Check', async () => {
  const fake = await scanEndpoint();
  const foreign = await scanEndpoint(
    // eslint-disable-next-line no-restricted-properties -- Second generated test listener port only.
    Number(process.env['SP_SCAN_FOREIGN_TEST_PORT'] ?? '0'),
  );
  const app = await launch('test', false, async (data) => {
    await mkdir(join(data, 'workspace'), { recursive: true });
    const db = await SQLiteStore.open(
      join(data, 'workspace', 'socialprune.sqlite'),
      { initial: scanWorkspace(1) },
    );
    await db.close();
  });
  try {
    const send = (value: object) =>
      call(
        app,
        DesktopRequestSchema.parse({
          requestId: crypto.randomUUID(),
          ...value,
        }),
      );
    expect(
      await send({
        type: 'scanSource',
        baseUrl: fake.origin + '/v1',
        model: 'generated-model',
        entriesPerRequest: 25,
        profile: 'openai-compatible',
      }),
    ).toMatchObject({ type: 'scanSource' });
    expect(fake.requests).toHaveLength(0);
    expect(
      await send({
        type: 'scanStart',
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: false,
        planHash: 'sha256:' + 'a'.repeat(64),
      }),
    ).toMatchObject({ type: 'desktopFailed', code: 'ENDPOINT_NOT_CONFIRMED' });
    expect(fake.requests).toHaveLength(0);
    fake.setRedirect(foreign.origin + '/v1/models');
    expect(await send({ type: 'scanCheck' })).toMatchObject({
      type: 'desktopFailed',
      code: 'REDIRECT_REFUSED',
    });
    expect(fake.requests).toHaveLength(1);
    expect(foreign.requests).toHaveLength(0);
  } finally {
    await app.close();
    await fake.close();
    await foreign.close();
  }
});

test('C5 packaged canary, Pause, Resume and stale Stop keep written batches', async () => {
  const fake = await scanEndpoint();
  const app = await launch('test', false, async (data) => {
    await mkdir(join(data, 'workspace'), { recursive: true });
    const db = await SQLiteStore.open(
      join(data, 'workspace', 'socialprune.sqlite'),
      { initial: scanWorkspace(75) },
    );
    await db.close();
  });
  try {
    const send = (value: object) =>
      call(
        app,
        DesktopRequestSchema.parse({
          requestId: crypto.randomUUID(),
          ...value,
        }),
      );
    await send({
      type: 'scanSource',
      baseUrl: fake.origin + '/v1',
      model: 'generated-model',
      entriesPerRequest: 25,
      profile: 'openai-compatible',
    });
    await send({ type: 'scanCheck' });
    const plan = await send({ type: 'scanPlan', accountKey: 'x:contract' });
    if (plan.type !== 'scanPlan') throw new Error('PLAN_MISSING');
    const start = (resume: boolean) =>
      send({
        type: 'scanStart',
        planHash: plan.plan.planHash,
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume,
      });
    fake.setHold(true);
    const first = await start(false);
    if (first.type !== 'scanStart') throw new Error('RUN_MISSING');
    await expect.poll(() => fake.held.size).toBe(1);
    const firstView = await send({ type: 'scanView' });
    if (firstView.type !== 'scanView') throw new Error('VIEW_MISSING');
    await send({
      type: 'scanAction',
      action: 'pause',
      runId: first.view.runId,
      version: firstView.view.version,
    });
    fake.release();
    await expect
      .poll(() => send({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'paused', stored: 25 },
      });
    const paused = await send({ type: 'scanView' });
    if (paused.type !== 'scanView') throw new Error('VIEW_MISSING');
    fake.setHold(false);
    await send({
      type: 'scanAction',
      action: 'resume',
      runId: first.view.runId,
      version: paused.view.version,
    });
    await expect
      .poll(() => send({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stored: 50, canResume: true },
      });
    expect(
      fake.requests
        .flatMap((request) => request.texts)
        .filter((text) => text.startsWith('Generated packaged')),
    ).toHaveLength(50);
    fake.setHold(true);
    const started = await start(true);
    if (started.type !== 'scanStart') throw new Error('RUN_MISSING');
    await expect.poll(() => fake.held.size).toBe(1);
    const action = (action: 'pause' | 'resume' | 'stop', version: number) =>
      send({ type: 'scanAction', runId: started.view.runId, version, action });
    const running = await send({ type: 'scanView' });
    if (running.type !== 'scanView') throw new Error('VIEW_MISSING');
    expect(await action('pause', running.view.version)).toMatchObject({
      type: 'scanAction',
      view: { pauseRequested: true },
    });
    // Stop accepts any view version; an open, unanswered batch must not store.
    expect(await action('stop', 0)).toMatchObject({
      type: 'scanAction',
      view: { phase: 'ending' },
    });
    await expect
      .poll(() => send({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stored: 0, stopCode: 'RUN_STOPPED' },
      });
    fake.setHold(false);
    await start(true);
    await expect
      .poll(() => send({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stored: 25, canResume: false },
      });
  } finally {
    await app.close();
    await fake.close();
  }
});

test('C5 packaged foundation uses real utility engine for confirmed loopback suggestions', async () => {
  const fake = await scanEndpoint();
  const app = await launch('test', false, async (data) => {
    const initial = scanWorkspace(1);
    initial.settings.criteria = {
      selected: ['political'],
      custom: [],
      nextCustom: 1,
      level: 0,
    };
    await mkdir(join(data, 'workspace'), { recursive: true });
    const db = await SQLiteStore.open(
      join(data, 'workspace', 'socialprune.sqlite'),
      { initial },
    );
    await db.close();
    await writeFile(join(data, 'generated.key'), 'generated-key-canary\n');
  });
  const network = await watchNetwork(
    join(dist, 'test'),
    join(app.data, 'scan-network.json'),
    [app.process.pid!],
  );
  let during: Awaited<ReturnType<typeof watchNetwork>> | undefined;
  let observation: Awaited<ReturnType<typeof network.stop>> | undefined;
  try {
    const mainPid = await app.application.evaluate(() => process.pid);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const baseline = await network.stop();
    expect(baseline.violations.length).toBeGreaterThan(0);
    expect(baseline.violations.length).toBeLessThanOrEqual(4);
    expect(
      baseline.violations.filter(
        (line) =>
          !(
            /^(connection|listener)$/.test(line.split('|')[0]!) &&
            line.split('|')[1] === String(mainPid) &&
            line.split('|')[2] === '2'
          ),
      ),
    ).toEqual([]);
    const harnessSockets = new Set(
      baseline.violations.map((line) => line.split('|').slice(0, 4).join('|')),
    );
    during = await watchNetwork(
      join(dist, 'test'),
      join(app.data, 'scan-during-network.json'),
      [app.process.pid!],
    );
    const send = async (
      request: Omit<Parameters<typeof call>[1], 'requestId'>,
    ) =>
      call(app, { ...request, requestId: crypto.randomUUID() } as Parameters<
        typeof call
      >[1]);
    await app.page
      .getByRole('button', { name: 'Model suggestions', exact: true })
      .click();
    await app.page
      .getByLabel('Endpoint base URL', { exact: true })
      .fill(fake.origin + '/v1');
    await app.page
      .getByLabel('Requested model', { exact: true })
      .fill('generated-model');
    await app.page
      .getByLabel('Entries per request', { exact: true })
      .fill('25');
    // Inject only the native dialog answer through the test driver. The packaged
    // test variant retains the release engine and has no fake-scan selector.
    await app.application.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = () =>
          Promise.resolve({
            canceled: false,
            filePaths: [path],
          });
      },
      join(app.data, 'generated.key'),
    );
    await app.page
      .getByRole('button', { name: 'Choose key file', exact: true })
      .click();
    expect(fake.requests).toHaveLength(0);
    expect(
      await app.page.evaluate(async (origin) => {
        try {
          await fetch(origin + '/renderer-decoy');
          return false;
        } catch {
          return true;
        }
      }, fake.origin),
    ).toBe(true);
    expect(
      await app.application.evaluate(async ({ net }, origin) => {
        try {
          await net.fetch(origin + '/main-decoy');
          return false;
        } catch {
          return true;
        }
      }, fake.origin),
    ).toBe(true);
    expect(fake.requests).toHaveLength(0);
    expect(
      app.errors.every((message) =>
        /Connecting to|Content Security Policy|Refused to connect/i.test(
          message,
        ),
      ),
    ).toBe(true);
    const expectedPolicyErrors = app.errors.length;
    await app.page
      .getByRole('button', { name: 'Check endpoint', exact: true })
      .click();
    await expect(
      app.page.getByRole('checkbox', {
        name: 'I want to send my entries there',
      }),
    ).toBeEnabled();
    await expect(
      app.page.getByRole('button', { name: 'Start', exact: true }),
    ).toBeDisabled();
    expect(fake.requests).toHaveLength(2);
    await app.page
      .getByRole('checkbox', { name: 'I want to send my entries there' })
      .check();
    await app.page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(app.page.getByTestId('scan-monitor')).toHaveAttribute(
      'data-phase',
      'ended',
    );
    expect(await send({ type: 'scanView' })).toMatchObject({
      type: 'scanView',
      view: { phase: 'ended', stored: 1, stopCode: null },
    });
    expect(fake.requests).toHaveLength(4);
    expect(
      fake.requests.every(
        (request) => request.authorization === 'Bearer generated-key-canary',
      ),
    ).toBe(true);
    const pageText = await app.page.locator('body').innerText();
    const log = await readFile(
      join(app.data, 'logs', 'desktop.ndjson'),
      'utf8',
    );
    expect(pageText + log).not.toContain('generated-key-canary');
    expect(app.errors).toHaveLength(expectedPolicyErrors);
    observation = await during.stop();
    const enginePid = await app.application.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      const engine = metrics.find(
        (metric) =>
          metric.name === 'SocialPrune Engine' ||
          metric.serviceName === 'SocialPrune Engine',
      );
      if (!engine)
        throw new Error(
          JSON.stringify(
            metrics.map(({ pid, type, name, serviceName }) => ({
              pid,
              type,
              name,
              serviceName,
            })),
          ),
        );
      return engine.pid;
    });
    // Local source ports in the OS table must match peers accepted by the
    // single generated origin, not just any connection owned by the engine.
    expect(observation.ticks).toBeGreaterThan(0);
    assertScanNetwork({
      observation,
      enginePid,
      peers: fake.peers,
      harnessSockets,
      requireEngineConnection: true,
    });
    // Test-only main-process violation proves the OS observer rejects an actual
    // connection outside the utility engine, not just fabricated table rows.
    const planted = await watchNetwork(
      join(dist, 'test'),
      join(app.data, 'scan-planted-network.json'),
      [mainPid],
    );
    const foreign = await scanEndpoint(
      // eslint-disable-next-line no-restricted-properties -- Second generated test listener port only.
      Number(process.env['SP_SCAN_FOREIGN_TEST_PORT'] ?? '0'),
    );
    let plantedObservation: Awaited<ReturnType<typeof planted.stop>>;
    try {
      await app.application.evaluate(async (_electron, url) => {
        const http = process.getBuiltinModule('node:http');
        await new Promise<void>((resolve, reject) => {
          const request = http.get(url + '/models', (response) => {
            response.resume();
            response.once('end', resolve);
          });
          request.once('error', reject);
        });
      }, foreign.origin);
      plantedObservation = await planted.stop();
      expect(foreign.requests).toHaveLength(1);
      expect(() =>
        assertScanNetwork({
          observation: plantedObservation,
          enginePid,
          peers: fake.peers,
          harnessSockets,
          requireEngineConnection: false,
        }),
      ).toThrow('SCAN_NETWORK_OUTSIDE_SCOPE');
    } finally {
      await planted.stop();
      await foreign.close();
    }
    const rows = JSON.parse(
      await windowsQuery('connections', String(enginePid)),
    ) as unknown[];
    expect(rows).toEqual([]);
    expect(() =>
      assertNoOwnedNetwork({
        ...observation!,
        violations: ['connection|generated-main|127.0.0.1'],
      }),
    ).toThrow('OWNED_NETWORK');
  } finally {
    if (!observation) await during?.stop();
    await network.stop();
    await app.close();
    await fake.close();
  }
});
