import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import { openTestEngine } from './engine-test-entry.ts';
import type { DesktopEngine } from '../src/engine/host.ts';
import type {
  RunView,
  DesktopRunAction,
} from '@socialprune/core/workspace/desktop-protocol';
import { RunViewSchema } from '@socialprune/core/workspace/desktop-protocol';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { createProfile } from '../src/browser/profile.ts';
import { fakeX } from './fake-x/server.ts';
import { FIXTURE, fixtureWorkspace } from './fake-x/fixture.ts';
import { fakeInstagram } from './fake-instagram/server.ts';
import { instagramFixture, IG_FIXTURE } from './fake-instagram/fixture.ts';
import { migrateOriginal } from '@socialprune/core';
import {
  DETAIL_FIXTURE,
  detailAnswer,
  detailPost,
} from '../src/originals/test/detail.ts';
import { TEST_PORTS, TEST_ORIGINS } from '../playwright.ports.config.ts';
import type { RunSession } from '../src/browser/run-session.ts';

async function generated(
  platform: 'x' | 'instagram',
  count = 1,
  variant: 'success' | 'side-429' = 'success',
) {
  const root = await mkdtemp(join(tmpdir(), 'sp-engine-control-'));
  await mkdir(join(root, 'workspace'));
  const instagram = await instagramFixture(count);
  const initial =
    platform === 'x' ? fixtureWorkspace(['1001', '1004']) : instagram.workspace;
  const store = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial },
  );
  await store.close();
  await createProfile(join(root, 'profiles', platform), platform);
  const fake =
    platform === 'x'
      ? await fakeX(TEST_PORTS.x)
      : await fakeInstagram(TEST_PORTS.engineInstagram, instagram.items);
  if ('setVariant' in fake) fake.setVariant(variant);
  if ('beforeList' in fake)
    fake.beforeList(async () => {
      await insideStep?.();
    });
  let now = Date.parse(platform === 'x' ? FIXTURE.now : IG_FIXTURE.now);
  let context: BrowserContext | undefined;
  let insideStep: (() => Promise<void>) | undefined;
  const views: RunView[] = [];
  const waits: number[] = [];
  const listStarts: number[] = [];
  const stepStarts: number[] = [];
  let stepUsed = 0;
  const commandLines: string[][] = [];
  let configureSession: ((session: RunSession) => void) | undefined;
  const engine: DesktopEngine = await openTestEngine(
    {
      dataFolder: root,
      windowPlacement: { x: 900, y: 0, width: 900, height: 1000 },
    },
    {
      xOrigin: platform === 'x' ? fake.origin : TEST_ORIGINS.x,
      instagramOrigin:
        platform === 'instagram'
          ? fake.origin
          : `http://127.0.0.1:${TEST_PORTS.engineInstagram}`,
      now: () => new Date(now),
      session: (value) => configureSession?.(value),
      beforeDelete: async () => {
        await insideStep?.();
      },
      sleep: (ms, signal) => {
        if (signal?.aborted)
          return Promise.reject(new Error('Generated cancelled wait'));
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
      async launched(value) {
        context = value;
        const cdp = await value.newCDPSession(value.pages()[0]!);
        const command = await cdp.send('Browser.getBrowserCommandLine');
        commandLines.push(command.arguments);
        await cdp.detach();
      },
    },
  );
  engine.onRunView((view) => {
    RunViewSchema.parse(view);
    views.push(view);
    if (view.phase !== 'idle' && view.today.used > stepUsed) {
      stepUsed = view.today.used;
      stepStarts.push(now);
    }
  });
  if ('beforeList' in fake)
    fake.beforeList(async () => {
      listStarts.push(now);
      await insideStep?.();
    });
  const current = () => views.at(-1)!;
  const action = async (action: DesktopRunAction) => {
    const view = current();
    if (view.phase === 'idle') throw new Error('No generated run');
    const reply = await engine.request({
      type: 'runAction',
      requestId: `generated-${action}-${view.version}`,
      runId: view.runId,
      version: view.version,
      action,
    });
    expect(reply.type).toBe('runActionResult');
    return reply;
  };
  return {
    root,
    fake,
    views,
    waits,
    listStarts,
    stepStarts,
    commandLines,
    engine,
    current,
    action,
    get context() {
      return context;
    },
    accountKey:
      platform === 'x' ? FIXTURE.account.key : instagram.items[0]!.account.key,
    setInsideStep(callback: () => Promise<void>) {
      insideStep = callback;
    },
    advance(ms: number) {
      now += ms;
    },
    configureSession(callback: (session: RunSession) => void) {
      configureSession = callback;
    },
    async begin() {
      const planned = await engine.request({
        type: 'planRun',
        requestId: 'generated-plan',
        platform,
        mode: platform === 'x' ? 'delete' : 'context',
        accountKey:
          platform === 'x'
            ? FIXTURE.account.key
            : instagram.items[0]!.account.key,
      });
      expect(planned.type).toBe('runPlanned');
      if (planned.type !== 'runPlanned')
        throw new Error(JSON.stringify(planned));
      const prepared = await engine.request({
        type: 'startRun',
        requestId: 'generated-prepare',
        planHash: planned.plan.planHash,
        browser: 'edge',
      });
      expect(prepared, JSON.stringify(prepared)).toMatchObject({
        type: 'runStarted',
        view: { phase: 'awaiting-warning' },
      });
      await action('acknowledge-warning');
      await action('start');
    },
    async close() {
      await context?.close();
      await engine.close();
      await fake.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('engine delete lifecycle watches canaries, pauses after an in-flight deletion, resumes checks and passes window placement', async () => {
  const h = await generated('x');
  let reached!: () => void, release!: () => void;
  const inStep = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const finishStep = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  h.setInsideStep(async () => {
    if (intercepted) return;
    intercepted = true;
    reached();
    await finishStep;
  });
  try {
    await h.begin();
    await expect
      .poll(() => intercepted || h.current().phase === 'ended', {
        timeout: 15000,
      })
      .toBe(true);
    expect(
      h.current(),
      JSON.stringify({ view: h.current(), requests: h.fake.requests }),
    ).not.toMatchObject({ phase: 'ended' });
    await inStep;
    await h.action('pause');
    expect(h.current()).toMatchObject({
      phase: 'running',
      pauseRequested: true,
    });
    release();
    await expect
      .poll(() => h.current().phase, { timeout: 15000 })
      .toBe('awaiting-continue');
    const journal = await SQLiteStore.open(
      join(h.root, 'workspace', 'socialprune.sqlite'),
      { readOnly: true },
    );
    expect(
      (await journal.browserJournal()).attempts.map((attempt) => attempt.state),
    ).toEqual(FIXTURE.expected.oneSuccessStates);
    await journal.close();
    const startedView = h.current();
    if (startedView.phase === 'idle') throw new Error('No generated run');
    expect(
      await h.engine.request({
        type: 'runAction',
        requestId: 'stale',
        runId: startedView.runId,
        version: startedView.version - 1,
        action: 'continue',
      }),
    ).toEqual({
      type: 'desktopFailed',
      requestId: 'stale',
      code: 'INVALID_ARGUMENTS',
    });
    await h.action('continue');
    await expect.poll(() => h.current().phase).toBe('paused');
    h.advance(60000);
    await h.action('resume');
    await expect
      .poll(() => h.current().phase, { timeout: 15000 })
      .toBe('awaiting-continue');
    await h.action('continue');
    await expect
      .poll(() => h.current().phase, { timeout: 15000 })
      .toBe('ended');
    expect(h.current()).toMatchObject({
      phase: 'ended',
      end: { reason: 'done' },
      progress: { completed: 2 },
      profile: { readback: { outcome: 'unchanged' } },
    });
    expect(h.commandLines[0]).toEqual(
      expect.arrayContaining([
        '--window-position=900,0',
        '--window-size=900,1000',
        '--enable-automation',
        '--disable-extensions',
      ]),
    );
    expect(h.commandLines[0]).not.toEqual(
      expect.arrayContaining(['--no-sandbox']),
    );
    expect(h.waits.filter((ms) => ms === 30000)).toHaveLength(1);
    expect(h.context?.pages().length).toBeGreaterThan(0);
    expect(
      await h.engine.request({
        type: 'planRun',
        requestId: 'busy-plan',
        platform: 'x',
        mode: 'delete',
        accountKey: h.accountKey,
      }),
    ).toEqual({
      type: 'desktopFailed',
      requestId: 'busy-plan',
      code: 'WORKSPACE_BUSY',
    });
    expect(
      await h.engine.request({
        type: 'startRun',
        requestId: 'busy-start',
        browser: 'edge',
        planHash: startedView.planHash!,
      }),
    ).toEqual({
      type: 'desktopFailed',
      requestId: 'busy-start',
      code: 'WORKSPACE_BUSY',
    });
    await h.context!.close();
    await expect
      .poll(
        async () =>
          (
            await h.engine.request({
              type: 'planRun',
              requestId: 'closed-plan',
              platform: 'x',
              mode: 'delete',
              accountKey: h.accountKey,
            })
          ).type,
      )
      .toBe('runPlanned');
  } finally {
    release();
    await h.close();
  }
});

test('Instagram engine pauses only after a complete step and rejects automatic canary acceptance', async () => {
  const h = await generated('instagram', 2);
  let reached!: () => void, release!: () => void;
  const inStep = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const finishStep = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  h.setInsideStep(async () => {
    if (intercepted) return;
    intercepted = true;
    reached();
    await finishStep;
  });
  try {
    await h.begin();
    await expect
      .poll(() => intercepted || h.current().phase === 'ended', {
        timeout: 30000,
      })
      .toBe(true);
    expect(h.current(), JSON.stringify(h.current())).not.toMatchObject({
      phase: 'ended',
    });
    await inStep;
    await h.action('pause');
    expect(h.current()).toMatchObject({
      phase: 'running',
      pauseRequested: true,
    });
    release();
    await expect
      .poll(() => h.current().phase, { timeout: 30000 })
      .toBe('awaiting-continue');
    await h.action('continue');
    await expect.poll(() => h.current().phase).toBe('paused');
    h.advance(60000);
    await h.action('resume');
    await expect
      .poll(() => h.current().phase, { timeout: 30000 })
      .toBe('awaiting-continue');
    expect(h.listStarts).toHaveLength(3);
    expect(h.stepStarts).toHaveLength(2);
    expect(h.listStarts[1]).toBe(h.listStarts[0]);
    expect(h.listStarts[2]! - h.listStarts[1]! - 60000).toBeGreaterThanOrEqual(
      30000,
    );
    expect(h.stepStarts[1]! - h.stepStarts[0]! - 60000).toBeGreaterThanOrEqual(
      30000,
    );
    await h.action('continue');
    await expect.poll(() => h.current().phase).toBe('canary-review');
    const store = await SQLiteStore.open(
      join(h.root, 'workspace', 'socialprune.sqlite'),
      { readOnly: true },
    );
    expect(
      (await store.browserJournal()).runs.every(
        (run) => run.canaryAcceptedAt === null,
      ),
    ).toBe(true);
    await store.close();
    await h.action('matches');
    await expect.poll(() => h.current().phase).toBe('ended');
    expect(h.current()).toMatchObject({
      phase: 'ended',
      end: { reason: 'canary' },
      progress: { completed: 2 },
      profile: { readback: { outcome: 'unchanged' } },
    });
    expect(h.commandLines[0]).toEqual(
      expect.arrayContaining([
        '--window-position=900,0',
        '--window-size=900,1000',
      ]),
    );
    const after = await SQLiteStore.open(
      join(h.root, 'workspace', 'socialprune.sqlite'),
      { readOnly: true },
    );
    expect(
      (await after.browserJournal()).runs[0]!.canaryAcceptedAt,
    ).not.toBeNull();
    await after.close();
    expect(h.context?.pages().length).toBeGreaterThan(0);
    expect(
      await h.engine.request({
        type: 'planRun',
        requestId: 'ig-window-open',
        platform: 'instagram',
        mode: 'context',
        accountKey: h.accountKey,
      }),
    ).toEqual({
      type: 'desktopFailed',
      requestId: 'ig-window-open',
      code: 'WORKSPACE_BUSY',
    });
    await h.engine.close();
    expect(h.context?.pages()).toEqual([]);
  } finally {
    release();
    await h.close();
  }
});

test('Instagram 429 before a list read ends with its token and unobserved read-back', async () => {
  const h = await generated('instagram', 1, 'side-429');
  try {
    await h.begin();
    await expect
      .poll(() => h.current().phase, { timeout: 30000 })
      .toBe('ended');
    expect(h.current()).toMatchObject({
      phase: 'ended',
      end: { detail: 'http-429', cliCode: 'PLATFORM_CHECK' },
      profile: { readback: { outcome: 'not-completed', accountBefore: null } },
    });
  } finally {
    await h.close();
  }
});

test('Stop during warning never starts a platform step', async () => {
  const h = await generated('x');
  try {
    const plan = await h.engine.request({
      type: 'planRun',
      requestId: 'stop-plan',
      platform: 'x',
      mode: 'delete',
      accountKey: h.accountKey,
    });
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    await h.engine.request({
      type: 'startRun',
      requestId: 'stop-prepare',
      planHash: plan.plan.planHash,
      browser: 'edge',
    });
    expect(h.context).toBeUndefined();
    expect(h.commandLines).toEqual([]);
    await h.action('stop');
    await expect.poll(() => h.current().phase).toBe('ended');
    expect(h.current()).toMatchObject({
      phase: 'ended',
      end: { reason: 'stopped-by-person' },
    });
    expect(
      h.fake.requests.filter((request) => request.method === 'POST'),
    ).toEqual([]);
  } finally {
    await h.close();
  }
});

test.each(['x', 'instagram'] as const)(
  '%s final projection throws still close through engine shutdown and leave a valid end',
  async (platform) => {
    const h = await generated(platform);
    h.configureSession((session) => {
      session.finish = () => {
        throw new Error('Generated final projection throw');
      };
    });
    try {
      await h.begin();
      await expect
        .poll(
          () =>
            h.current().phase === 'awaiting-continue' ||
            h.current().phase === 'ended',
          { timeout: 15000 },
        )
        .toBe(true);
      await h.action('stop');
      await expect
        .poll(() => h.current().phase, { timeout: 15000 })
        .toBe('ended');
      expect(h.current()).toMatchObject({
        phase: 'ended',
        end: { reason: 'error', detail: 'other' },
      });
      await h.engine.close();
      expect(h.context?.pages()).toEqual([]);
    } finally {
      await h.close();
    }
  },
);

test('X delete resume rejects a changed language with a platform-check end', async () => {
  const h = await generated('x');
  try {
    await h.begin();
    await expect
      .poll(() => h.current().phase, { timeout: 15000 })
      .toBe('awaiting-continue');
    await h.action('pause');
    await h.action('continue');
    await expect.poll(() => h.current().phase).toBe('paused');
    const page = h
      .context!.pages()
      .find((page) => page.url().startsWith(h.fake.origin))!;
    await page.evaluate(() => {
      document.documentElement.lang = 'de';
    });
    await h.action('resume');
    await expect
      .poll(() => h.current().phase, { timeout: 15000 })
      .toBe('ended');
    expect(h.current()).toMatchObject({
      phase: 'ended',
      end: { reason: 'platform-check', cliCode: 'PAGE_LANGUAGE' },
    });
  } finally {
    await h.close();
  }
});

test('fill HTTP 429 keeps its cause even when rate headers exceed the Date range', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-engine-rate-429-'));
  await mkdir(join(root, 'workspace'));
  const initial = fixtureWorkspace(['1001']);
  initial.items[0]!.kind = 'reply';
  initial.items[0]!.reference.replyToId = '910';
  initial.originals = [
    migrateOriginal({
      id: '910',
      status: 'fetched',
      fetchedAt: FIXTURE.now,
      text: 'Generated beginning',
      authorName: DETAIL_FIXTURE.name,
      authorHandle: DETAIL_FIXTURE.handle,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { note_tweet: {} },
      textCompleteness: 'truncated',
      video: null,
    }),
  ];
  initial.counts.originals = 1;
  const db = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial },
  );
  await db.close();
  await createProfile(join(root, 'profiles', 'x'));
  const server = createServer((request, response) => {
    const path = new URL(request.url!, TEST_ORIGINS.x).pathname;
    if (path.includes('/i/api/')) {
      response.writeHead(429, {
        'Content-Type': 'application/json',
        'x-rate-limit-limit': '50',
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '9000000000001',
      });
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      `<!doctype html><html lang="en"><body><button data-testid="SideNav_AccountSwitcher_Button">@${FIXTURE.account.handle}</button>${path === '/home' ? '' : `<article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><p data-testid="tweetText">Generated rate test</p></article><script>fetch('/i/api/graphql/generated/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'910'})))</script>`}</body></html>`,
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(TEST_PORTS.x, '127.0.0.1', resolve),
  );
  let context: BrowserContext | undefined;
  const engine = await openTestEngine(
    { dataFolder: root },
    {
      xOrigin: TEST_ORIGINS.x,
      instagramOrigin: `http://127.0.0.1:${TEST_PORTS.engineInstagram}`,
      now: () => new Date(FIXTURE.now),
      launched: (value) => {
        context = value;
        return Promise.resolve();
      },
    },
  );
  let view: RunView = { phase: 'idle', version: 0 };
  engine.onRunView((value) => {
    RunViewSchema.parse(value);
    view = value;
  });
  const current = (): RunView => view;
  try {
    const plan = await engine.request({
      type: 'planRun',
      requestId: 'rate-plan',
      platform: 'x',
      mode: 'fill',
      accountKey: FIXTURE.account.key,
    });
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    await engine.request({
      type: 'startRun',
      requestId: 'rate-prepare',
      browser: 'edge',
      planHash: plan.plan.planHash,
    });
    for (const action of ['acknowledge-warning', 'start'] as const) {
      const live = current();
      if (live.phase === 'idle') throw new Error('No rate run');
      await engine.request({
        type: 'runAction',
        requestId: action,
        runId: live.runId,
        version: live.version,
        action,
      });
    }
    await expect.poll(() => view.phase, { timeout: 15000 }).toBe('ended');
    expect(view).toMatchObject({
      phase: 'ended',
      end: {
        reason: 'platform-check',
        detail: 'http-429',
        cliCode: 'PLATFORM_CHECK',
      },
    });
  } finally {
    await context?.close();
    await engine.close();
    expect(context?.pages()).toEqual([]);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('engine fill watches Continue and Matches, preserves rate-operation identity and pauses between pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-engine-fill-'));
  await mkdir(join(root, 'workspace'));
  const initial = fixtureWorkspace(['1001', '1004']);
  const ids = ['910', '909'];
  initial.items.forEach((item, index) => {
    item.kind = 'reply';
    item.reference.replyToId = ids[index]!;
  });
  initial.originals = ids.map((id) =>
    migrateOriginal({
      id,
      status: 'fetched',
      fetchedAt: FIXTURE.now,
      text: 'Generated beginning',
      authorName: DETAIL_FIXTURE.name,
      authorHandle: DETAIL_FIXTURE.handle,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { note_tweet: {} },
      textCompleteness: 'truncated',
      video: null,
    }),
  );
  initial.counts.originals = ids.length;
  const db = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial },
  );
  await db.close();
  await createProfile(join(root, 'profiles', 'x'));
  let now = Date.parse(FIXTURE.now);
  let context: BrowserContext | undefined;
  let inherited: import('playwright-core').Page[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url!, TEST_ORIGINS.x);
    if (url.pathname.includes('/i/api/graphql/')) {
      const id =
        (
          JSON.parse(url.searchParams.get('variables') ?? '{}') as {
            focalTweetId?: string;
          }
        ).focalTweetId ?? '910';
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'x-rate-limit-limit': '50',
        'x-rate-limit-remaining': '45',
        'x-rate-limit-reset': String(Math.floor(now / 1000) + 900),
      });
      response.end(JSON.stringify(detailAnswer(detailPost(id))));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    const id = url.pathname.split('/').at(-1)!;
    response.end(
      `<!doctype html><html lang="en"><body><button data-testid="SideNav_AccountSwitcher_Button">@${FIXTURE.account.handle}</button>${url.pathname === '/home' ? '' : `<article data-testid="tweet"><a href="/generated/status/${id}"><time>2026</time></a><p data-testid="tweetText">${DETAIL_FIXTURE.text}</p></article><script>for(const operation of ['TweetDetail','GeneratedOtherQuery'])fetch('/i/api/graphql/generated/'+operation+'?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'${id}'})))</script>`}</body></html>`,
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(TEST_PORTS.x, '127.0.0.1', resolve),
  );
  const views: RunView[] = [];
  const engine = await openTestEngine(
    { dataFolder: root },
    {
      xOrigin: TEST_ORIGINS.x,
      instagramOrigin: `http://127.0.0.1:${TEST_PORTS.engineInstagram}`,
      now: () => new Date(now),
      launched(value) {
        context = value;
        inherited = value.pages();
        return Promise.resolve();
      },
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    },
  );
  engine.onRunView((view) => {
    RunViewSchema.parse(view);
    views.push(view);
  });
  const action = async (action: DesktopRunAction) => {
    const current = views.at(-1)!;
    if (current.phase === 'idle') throw new Error('No fill run');
    expect(
      (
        await engine.request({
          type: 'runAction',
          requestId: `fill-${action}`,
          runId: current.runId,
          version: current.version,
          action,
        })
      ).type,
    ).toBe('runActionResult');
  };
  try {
    const plan = await engine.request({
      type: 'planRun',
      requestId: 'fill-plan',
      platform: 'x',
      mode: 'fill',
      accountKey: FIXTURE.account.key,
    });
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    expect(plan.plan.rows[0]).toMatchObject({
      action: 'read-post',
      firstLine: FIXTURE.rows[0].text.split('\n')[0],
      textTruncated: true,
    });
    expect(
      (
        await engine.request({
          type: 'startRun',
          requestId: 'fill-start',
          browser: 'edge',
          planHash: plan.plan.planHash,
        })
      ).type,
    ).toBe('runStarted');
    await action('acknowledge-warning');
    await action('start');
    await expect
      .poll(
        () =>
          views.at(-1)?.phase === 'awaiting-continue' ||
          views.at(-1)?.phase === 'ended',
        { timeout: 15000 },
      )
      .toBe(true);
    expect(views.at(-1), JSON.stringify(views.at(-1))).toMatchObject({
      phase: 'awaiting-continue',
    });
    await action('pause');
    await action('continue');
    await expect.poll(() => views.at(-1)?.phase).toBe('paused');
    now += 60000;
    await action('resume');
    await expect
      .poll(() => views.at(-1)?.phase, { timeout: 15000 })
      .toBe('awaiting-continue');
    await action('continue');
    await expect.poll(() => views.at(-1)?.phase).toBe('canary-review');
    await action('matches');
    await expect.poll(() => views.at(-1)?.phase).toBe('ended');
    const final = views.at(-1)!;
    expect(final).toMatchObject({
      phase: 'ended',
      progress: { completed: 2 },
      end: { reason: 'canary' },
    });
    if (final.phase === 'idle') throw new Error('No fill run');
    expect(final.xWindows).toContainEqual({
      operation: 'graphql-other',
      operationName: 'GeneratedOtherQuery',
      limit: 50,
      remaining: 45,
      resetAt: new Date(now + 900000).toISOString(),
    });
    expect(inherited.every((page) => page.isClosed())).toBe(true);
    expect(context!.pages().length).toBeGreaterThan(0);
    expect(context!.pages().some((page) => inherited.includes(page))).toBe(
      false,
    );
    expect(
      await engine.request({
        type: 'planRun',
        requestId: 'fill-window-open',
        platform: 'x',
        mode: 'fill',
        accountKey: FIXTURE.account.key,
      }),
    ).toEqual({
      type: 'desktopFailed',
      requestId: 'fill-window-open',
      code: 'WORKSPACE_BUSY',
    });
    await engine.close();
    expect(context!.pages()).toEqual([]);
  } finally {
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('fill reload Resume defers the account check until the newly opened page renders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-engine-reload-resume-'));
  await mkdir(join(root, 'workspace'));
  const initial = fixtureWorkspace(['1001']);
  initial.items[0]!.kind = 'reply';
  initial.items[0]!.reference.replyToId = '910';
  initial.originals = [
    migrateOriginal({
      id: '910',
      status: 'fetched',
      fetchedAt: FIXTURE.now,
      text: 'Generated beginning',
      authorName: DETAIL_FIXTURE.name,
      authorHandle: DETAIL_FIXTURE.handle,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { note_tweet: {} },
      textCompleteness: 'truncated',
      video: null,
    }),
  ];
  initial.counts.originals = 1;
  const db = await SQLiteStore.open(
    join(root, 'workspace', 'socialprune.sqlite'),
    { initial },
  );
  const prior = {
    runId: 'generated-watched-fill',
    platform: 'x' as const,
    accountKey: FIXTURE.account.key,
    mode: 'fill' as const,
    planHash: 'a'.repeat(64),
    startedAt: '2026-10-10T12:00:00.000Z',
    endedAt: '2026-10-10T12:01:00.000Z',
    endReason: 'canary' as const,
    canaryAcceptedAt: '2026-10-10T12:01:00.000Z',
    bodyShapes: {},
    profileReport: null,
  };
  await db.write((tx) => tx.browserRuns.add(prior));
  await db.close();
  await createProfile(join(root, 'profiles', 'x'));
  let visits = 0,
    now = Date.parse(FIXTURE.now);
  const server = createServer((request, response) => {
    const url = new URL(request.url!, TEST_ORIGINS.x);
    if (url.pathname.includes('/i/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(detailAnswer(detailPost('910'))));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname !== '/home' && ++visits === 1) {
      response.end(
        '<!doctype html><html lang="en"><body>Generated unrendered page</body></html>',
      );
      return;
    }
    response.end(
      `<!doctype html><html lang="en"><body><button data-testid="SideNav_AccountSwitcher_Button">@${FIXTURE.account.handle}</button>${url.pathname === '/home' ? '' : `<article data-testid="tweet"><a href="/generated/status/910"><time>2026</time></a><p data-testid="tweetText">${DETAIL_FIXTURE.text}</p></article><script>fetch('/i/api/graphql/generated/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'910'})))</script>`}</body></html>`,
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(TEST_PORTS.x, '127.0.0.1', resolve),
  );
  let releaseWait!: () => void;
  const waitGate = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  const waits: number[] = [];
  const engine = await openTestEngine(
    { dataFolder: root },
    {
      xOrigin: TEST_ORIGINS.x,
      instagramOrigin: `http://127.0.0.1:${TEST_PORTS.engineInstagram}`,
      now: () => new Date(now),
      sleep: (ms, signal) => {
        waits.push(ms);
        if (waits.length === 1)
          return new Promise<void>((resolve) => {
            signal?.addEventListener('abort', () => resolve(), { once: true });
            void waitGate.then(resolve);
          });
        now += ms;
        return Promise.resolve();
      },
    },
  );
  let view: RunView = { phase: 'idle', version: 0 };
  engine.onRunView((value) => {
    view = value;
  });
  const action = async (action: DesktopRunAction) => {
    if (view.phase === 'idle') throw new Error('No reload run');
    expect(
      (
        await engine.request({
          type: 'runAction',
          requestId: action,
          runId: view.runId,
          version: view.version,
          action,
        })
      ).type,
    ).toBe('runActionResult');
  };
  try {
    const plan = await engine.request({
      type: 'planRun',
      requestId: 'reload-plan',
      platform: 'x',
      mode: 'fill',
      accountKey: FIXTURE.account.key,
    });
    if (plan.type !== 'runPlanned') throw new Error(JSON.stringify(plan));
    expect(plan.plan.canary).toBe(false);
    await engine.request({
      type: 'startRun',
      requestId: 'reload-prepare',
      browser: 'edge',
      planHash: plan.plan.planHash,
    });
    await action('acknowledge-warning');
    await action('start');
    await expect.poll(() => view.phase, { timeout: 15000 }).toBe('reload-wait');
    await action('pause');
    await expect.poll(() => view.phase).toBe('paused');
    now += 60000;
    await action('resume');
    await expect.poll(() => view.phase, { timeout: 15000 }).toBe('ended');
    expect(view).toMatchObject({
      phase: 'ended',
      progress: { completed: 1 },
      end: { reason: 'done' },
    });
    expect(visits).toBe(2);
  } finally {
    releaseWait();
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
