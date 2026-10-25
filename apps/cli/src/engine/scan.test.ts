import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fakeEndpoint } from '../../../../packages/classify/test/fake-endpoint.ts';
import { EngineRequestSchema } from './host.ts';
import { openEngine } from './index.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';
import { EngineScan } from './scan.ts';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { records } from '@socialprune/core/workspace/store';
import { RunControls } from '../browser/run-controls.ts';
import {
  DesktopScanViewSchema,
  DesktopRequestSchema,
  parseDesktopReply,
} from '@socialprune/core/workspace/desktop-protocol';

test('C5 protocol refuses paths, content, stale reply identities and out-of-bound canary progress', () => {
  const view = new EngineScan('generated', () => new Date(), RunControls).view;
  for (const patch of [
    { text: 'generated content canary' },
    { batchSize: 51 },
    { planned: 51, stored: 0, remaining: 51, limit: 50 },
    { phase: 'running' },
    { canResume: true },
  ])
    expect(DesktopScanViewSchema.safeParse({ ...view, ...patch }).success).toBe(
      false,
    );
  expect(
    DesktopRequestSchema.safeParse({
      requestId: 'key',
      type: 'scanKey',
      path: 'C:\\generated.key',
    }).success,
  ).toBe(false);
  expect(
    DesktopRequestSchema.safeParse({
      requestId: 'start',
      type: 'scanStart',
      planHash: 'sha256:' + 'a'.repeat(64),
      origin: 'http://localhost:1234',
      answeringModel: 'generated-model',
      agreed: true,
      resume: false,
    }).success,
  ).toBe(false);
  expect(() =>
    parseDesktopReply(
      { requestId: 'expected', type: 'scanView' },
      { requestId: 'foreign', type: 'scanView', view },
    ),
  ).toThrow();
});

test('C5 pause waits for an open request, resume continues, stale Stop aborts and retry pause holds its remaining wait', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-desktop-scan-controls-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const fixture = contractWorkspace();
  fixture.settings.criteria = {
    selected: ['political'],
    custom: [],
    nextCustom: 1,
    level: 0,
  };
  fixture.items = Array.from({ length: 6 }, (_, index) => ({
    ...fixture.items[0]!,
    id: `x:generated-${index}`,
    text: `Generated control note ${index}.`,
  }));
  fixture.counts.items = fixture.items.length;
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial: fixture,
  });
  await store.close();
  const scan = new EngineScan(workspace, () => new Date(), RunControls);
  const held: { response: ServerResponse; entries: { id: string }[] }[] = [];
  let mode: 'normal' | 'hold' | 'retry' = 'normal';
  let requests = 0;
  const respond = (response: ServerResponse, entries: { id: string }[]) =>
    response.end(
      JSON.stringify({
        model: 'generated-model',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                results: entries.map(({ id }) => ({ id, labels: [] })),
              }),
            },
          },
        ],
      }),
    );
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests++;
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.endsWith('/models')) {
        response.end(JSON.stringify({ data: [{ id: 'generated-model' }] }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages: { content: string }[];
      };
      const entries = JSON.parse(body.messages[1]!.content) as {
        id: string;
        text: string;
      }[];
      if (entries[0]?.text.startsWith('Generated control')) {
        if (mode === 'hold') {
          held.push({ response, entries });
          return;
        }
        if (mode === 'retry') {
          response.writeHead(503);
          response.end('Generated retry');
          return;
        }
      }
      respond(response, entries);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (value: object) =>
    scan.handle(
      EngineRequestSchema.parse({
        requestId: crypto.randomUUID(),
        ...value,
      }) as Parameters<EngineScan['handle']>[0],
    );
  try {
    await call({
      type: 'scanSource',
      baseUrl: origin + '/v1',
      model: 'generated-model',
      profile: 'openai-compatible',
      entriesPerRequest: 1,
    });
    await call({ type: 'scanCheck' });
    const plan = await call({
      type: 'scanPlan',
      accountKey: fixture.items[0]!.account.key,
    });
    if (plan.type !== 'scanPlan') throw new Error('PLAN_MISSING');
    const start = () =>
      call({
        type: 'scanStart',
        origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: false,
        planHash: plan.plan.planHash,
      });
    const action = (
      action: 'pause' | 'resume' | 'stop',
      version = scan.view.version,
    ) => call({ type: 'scanAction', runId: scan.view.runId, version, action });
    mode = 'hold';
    await start();
    await expect.poll(() => held.length).toBe(1);
    await action('pause');
    expect(scan.view).toMatchObject({
      phase: 'running',
      pauseRequested: true,
      stored: 0,
    });
    respond(held[0]!.response, held[0]!.entries);
    await expect.poll(() => scan.view.phase).toBe('paused');
    expect(scan.view.stored).toBe(1);
    const atPause = requests;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toBe(atPause);
    await action('resume');
    await expect.poll(() => held.length).toBe(2);
    await action('stop', 0);
    await expect.poll(() => scan.view.phase).toBe('ended');
    expect(scan.view).toMatchObject({ stored: 1, stopCode: 'RUN_STOPPED' });
    mode = 'retry';
    await start();
    await expect.poll(() => scan.view.retries).toBe(1);
    await action('pause');
    await expect.poll(() => scan.view.phase).toBe('paused');
    const retryPause = requests;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toBe(retryPause);
    await action('stop', 0);
    await expect.poll(() => scan.view.phase).toBe('ended');
  } finally {
    await scan.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('C5 scan setup makes no requests, rejects unconfirmed Start and caps the first run at 50', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-desktop-scan-'));
  const fake = await fakeEndpoint((input) =>
    input.url.endsWith('/models')
      ? { body: { data: [{ id: 'generated-model' }] } }
      : {},
  );
  await mkdir(join(root, 'workspace'));
  const fixture = contractWorkspace();
  fixture.items = Array.from({ length: 75 }, (_, index) => ({
    ...fixture.items[0]!,
    id: `x:generated-${index}`,
    text: `Generated desktop scan note ${index}.`,
  }));
  fixture.counts.items = fixture.items.length;
  fixture.settings.criteria = {
    selected: ['political'],
    custom: [],
    nextCustom: 1,
    level: 0,
  };
  const store = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial: fixture },
  );
  await store.close();
  const engine = await openEngine({ dataFolder: root });
  const call = (value: unknown) =>
    engine.request(
      EngineRequestSchema.parse({
        requestId: crypto.randomUUID(),
        ...(value as object),
      }),
    );
  try {
    expect(
      await call({
        type: 'scanSource',
        baseUrl: fake.origin + '/v1',
        model: 'generated-model',
        entriesPerRequest: 25,
        profile: 'openai-compatible',
      }),
    ).toMatchObject({
      type: 'scanSource',
      setup: { origin: fake.origin, keyFile: null },
    });
    expect(fake.requests).toHaveLength(0);
    expect(
      await call({
        type: 'scanStart',
        planHash: 'sha256:' + 'a'.repeat(64),
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: false,
      }),
    ).toMatchObject({ type: 'desktopFailed', code: 'ENDPOINT_NOT_CONFIRMED' });
    expect(fake.requests).toHaveLength(0);
    const checked = await call({ type: 'scanCheck' });
    expect(checked).toMatchObject({
      type: 'scanCheck',
      setup: { modelListed: true, answeringModel: 'generated-model' },
    });
    const planned = await call({
      type: 'scanPlan',
      accountKey: fixture.items[0]!.account.key,
    });
    if (planned.type !== 'scanPlan') throw new Error(JSON.stringify(planned));
    const noSend = fake.requests.length;
    expect(
      await call({
        type: 'scanStart',
        planHash: planned.plan.planHash,
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: true,
      }),
    ).toMatchObject({ type: 'desktopFailed', code: 'STALE_PLAN' });
    expect(fake.requests).toHaveLength(noSend);
    expect(
      await call({
        type: 'scanStart',
        planHash: planned.plan.planHash,
        origin: fake.origin,
        answeringModel: 'wrong-model',
        agreed: true,
        resume: false,
      }),
    ).toMatchObject({ type: 'desktopFailed', code: 'ENDPOINT_NOT_CONFIRMED' });
    const before = fake.requests.length;
    expect(
      await call({
        type: 'scanStart',
        planHash: planned.plan.planHash,
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: false,
      }),
    ).toMatchObject({
      type: 'scanStart',
      view: { phase: 'running', limit: 50 },
    });
    await expect
      .poll(async () => call({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stopCode: null },
      });
    expect(fake.requests.length).toBeGreaterThan(before);
    const texts = () =>
      fake.requests
        .flatMap((request) =>
          request.body
            ? (JSON.parse(
                (request.body.messages as { content: string }[])[1]!.content,
              ) as { text: string }[])
            : [],
        )
        .filter((entry) =>
          entry.text.startsWith('Generated desktop scan note'),
        );
    expect(texts()).toHaveLength(50);
    expect(
      await call({
        type: 'scanStart',
        planHash: planned.plan.planHash,
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: true,
      }),
    ).toMatchObject({ type: 'scanStart', view: { limit: null } });
    await expect
      .poll(async () => call({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stored: 25, remaining: 0 },
      });
    expect(texts()).toHaveLength(75);
    expect(new Set(texts().map((entry) => entry.text)).size).toBe(75);
    expect(await call({ type: 'scanView' })).toMatchObject({
      type: 'scanView',
      view: { canResume: false },
    });
    const verify = await SQLiteStore.open(
      join(root, 'workspace', 'socialprune.sqlite'),
    );
    try {
      const snapshot = await verify.read(async (tx) => ({
        decisions: (await records(tx.decisionEvents)).length,
        assessments: (await records(tx.assessments)).length,
      }));
      expect(snapshot).toEqual({ decisions: 0, assessments: 75 });
    } finally {
      await verify.close();
    }
  } finally {
    await engine.close();
    await fake.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('C5 key selection stays on the private host channel and invalid config files send nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-scan-key-'));
  const fake = await fakeEndpoint((request) =>
    request.url.endsWith('/models')
      ? { body: { data: [{ id: 'generated-model' }] } }
      : {},
  );
  const engine = await openEngine({ dataFolder: root });
  const key = join(root, 'generated.key');
  try {
    await writeFile(key, '{"apiKey":"generated-decoy-config"}\n');
    const request = { requestId: 'key', type: 'scanKey' as const };
    expect(
      await engine.handleHost({
        request,
        selection: { type: 'scanKey', path: key },
      }),
    ).toMatchObject({ type: 'scanKey', keyFile: key });
    expect(
      await engine.request({
        type: 'scanSource',
        requestId: 'source',
        baseUrl: fake.origin + '/v1',
        model: 'generated-model',
        entriesPerRequest: 25,
        profile: 'openai-compatible',
      }),
    ).toMatchObject({ type: 'scanSource', setup: { keyFile: key } });
    expect(fake.requests).toHaveLength(0);
    expect(
      await engine.request({ type: 'scanCheck', requestId: 'invalid-key' }),
    ).toMatchObject({ type: 'desktopFailed', code: 'KEY_FILE_INVALID' });
    expect(fake.requests).toHaveLength(0);
    await writeFile(key, 'generated-key-canary\n');
    const checked = await engine.request({
      type: 'scanCheck',
      requestId: 'checked-key',
    });
    expect(checked).toMatchObject({
      type: 'scanCheck',
      setup: { keyFile: key },
    });
    expect(JSON.stringify(checked)).not.toContain('generated-key-canary');
    expect(
      fake.requests.every(
        (request) => request.authorization === 'Bearer generated-key-canary',
      ),
    ).toBe(true);
    expect(
      await engine.handleHost({
        request: { requestId: 'cancel-key', type: 'scanKey' },
        selection: { type: 'scanKey', path: null },
      }),
    ).toMatchObject({ type: 'scanKey', keyFile: key });
    expect(
      await engine.request({
        requestId: 'clear-key',
        type: 'scanKey',
        clear: true,
      }),
    ).toMatchObject({ type: 'scanKey', keyFile: null });
  } finally {
    await engine.close();
    await fake.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('C5 restarting the utility engine skips every stored canary entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-scan-restart-'));
  await mkdir(join(root, 'workspace'));
  const fixture = contractWorkspace();
  fixture.settings.criteria = {
    selected: ['political'],
    custom: [],
    nextCustom: 1,
    level: 0,
  };
  fixture.items = Array.from({ length: 75 }, (_, index) => ({
    ...fixture.items[0]!,
    id: `x:restart-${index}`,
    text: `Generated restart note ${index}.`,
  }));
  fixture.counts.items = 75;
  const db = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial: fixture },
  );
  await db.close();
  const fake = await fakeEndpoint((request) =>
    request.url.endsWith('/models')
      ? { body: { data: [{ id: 'generated-model' }] } }
      : {},
  );
  let engine = await openEngine({ dataFolder: root });
  const call = (value: object) =>
    engine.request(
      EngineRequestSchema.parse({ requestId: crypto.randomUUID(), ...value }),
    );
  const prepare = async () => {
    await call({
      type: 'scanSource',
      baseUrl: fake.origin + '/v1',
      model: 'generated-model',
      profile: 'openai-compatible',
      entriesPerRequest: 25,
    });
    await call({ type: 'scanCheck' });
    const plan = await call({ type: 'scanPlan', accountKey: 'x:contract' });
    if (plan.type !== 'scanPlan') throw new Error('PLAN_MISSING');
    return plan;
  };
  try {
    let plan = await prepare();
    const start = () =>
      call({
        type: 'scanStart',
        planHash: plan.plan.planHash,
        origin: fake.origin,
        answeringModel: 'generated-model',
        agreed: true,
        resume: false,
      });
    await start();
    await expect
      .poll(() => call({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stored: 50 },
      });
    await engine.close();
    engine = await openEngine({ dataFolder: root });
    plan = await prepare();
    expect(plan.plan).toMatchObject({ planned: 25, skipped: 50 });
    await start();
    await expect
      .poll(() => call({ type: 'scanView' }))
      .toMatchObject({
        type: 'scanView',
        view: { phase: 'ended', stored: 25 },
      });
    const texts = fake.requests
      .flatMap((request) =>
        request.body
          ? (JSON.parse(
              (request.body.messages as { content: string }[])[1]!.content,
            ) as { text: string }[])
          : [],
      )
      .filter((entry) => entry.text.startsWith('Generated restart'));
    expect(texts).toHaveLength(75);
    expect(new Set(texts.map((entry) => entry.text)).size).toBe(75);
  } finally {
    await engine.close();
    await fake.close();
    await rm(root, { recursive: true, force: true });
  }
});
