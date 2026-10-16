import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  DesktopRequestSchema,
  DesktopReplySchema,
  RunViewSchema,
  parseDesktopReply,
} from './desktop-protocol.ts';

const time = '2026-10-16T12:00:00.000Z';
const hash = 'a'.repeat(64);
const requestId = 'generated-request';

function running() {
  return {
    phase: 'running',
    version: 1,
    runId: 'generated-run',
    platform: 'x',
    mode: 'fill',
    accountKey: 'x:generated',
    expectedHandle: 'generated',
    planHash: hash,
    canary: false,
    pauseRequested: false,
    progress: {
      planned: 2,
      completed: 0,
      marked: 0,
      bulk: 0,
      settled: {
        withdrawn: 0,
        deleted: 0,
        'not-found': 0,
        failed: 0,
        ambiguous: 0,
        'not-deleted': 0,
        'still-gone': 0,
        reappeared: 0,
        read: 0,
        tombstone: 0,
        unavailable: 0,
        confirmed: 0,
        unconfirmed: 0,
        'not-listed': 0,
      },
    },
    today: {
      date: '2026-10-16',
      timeZone: 'Europe/Berlin',
      used: 1,
      cap: 200,
      unit: 'pages',
      sharedWithXDeleteAndFill: true,
    },
    pace: { secondsPerStep: 30, batchSize: 20, batchPauseMs: 900_000 },
    nextStepAt: null,
    currentEntry: {
      kind: 'reply',
      date: time,
      firstLine: 'Generated own reply',
      textTruncated: false,
      action: 'read-post',
    },
    journal: [
      { at: time, action: 'read-post', outcome: 'sending', code: null },
    ],
    xWindows: [
      {
        operation: 'TweetDetail',
        operationName: null,
        limit: 50,
        remaining: 49,
        resetAt: time,
      },
    ],
    instagram: null,
    warning: { form: 'full', acknowledged: true, text: 'Generated warning' },
    profile: {
      canChange: ['Generated profile change description'],
      before: { account: 'generated', extensionIds: [] },
      readback: null,
    },
    browserWindow: { browser: 'edge', placement: 'beside' },
  };
}

test('red control: unknown phase is rejected', () => {
  expect(RunViewSchema.safeParse({ phase: 'generated-unknown' }).success).toBe(
    false,
  );
});
test('red control: unknown outcome token is rejected', () => {
  expect(
    RunViewSchema.safeParse({
      ...running(),
      journal: [
        {
          at: time,
          action: 'read-post',
          outcome: 'generated-unknown',
          code: null,
        },
      ],
    }).success,
  ).toBe(false);
});
test('red control: over-long string is rejected', () => {
  expect(
    DesktopRequestSchema.safeParse({
      type: 'runView',
      requestId: 'r'.repeat(513),
    }).success,
  ).toBe(false);
});
test('red control: extra key is rejected', () => {
  expect(
    RunViewSchema.safeParse({ ...running(), generatedExtra: true }).success,
  ).toBe(false);
});
test('red control: renderer path is rejected', () => {
  expect(
    DesktopRequestSchema.safeParse({
      type: 'importExport',
      requestId,
      path: 'C:/generated/export.zip',
    }).success,
  ).toBe(false);
});
test('red control: request outside the union is rejected', () => {
  expect(
    DesktopRequestSchema.safeParse({
      type: 'dispatch',
      requestId,
      method: 'approve',
    }).success,
  ).toBe(false);
});

test('every desktop method has a bounded strict request and no renderer-selected path or order', () => {
  const methods = [
    {
      type: 'planRun',
      platform: 'x',
      mode: 'delete',
      accountKey: 'x:generated',
    },
    {
      type: 'planRun',
      platform: 'x',
      mode: 'verify',
      accountKey: 'x:generated',
    },
    { type: 'planRun', platform: 'x', mode: 'fill', accountKey: 'x:generated' },
    {
      type: 'planRun',
      platform: 'instagram',
      mode: 'context',
      accountKey: 'instagram:generated',
      handle: 'generated.name',
    },
    { type: 'startRun', planHash: hash, browser: 'edge' },
    ...[
      'acknowledge-warning',
      'start',
      'continue',
      'matches',
      'does-not-match',
      'pause',
      'resume',
      'stop',
    ].map((action) => ({
      type: 'runAction',
      runId: 'generated-run',
      version: 1,
      action,
    })),
    { type: 'runView' },
    { type: 'browsers' },
    { type: 'profileStatus', platform: 'x' },
    { type: 'profileStatus', platform: 'instagram' },
    { type: 'profileSetup', platform: 'x', browser: 'chrome' },
    { type: 'profileSetup', platform: 'instagram', browser: 'edge' },
    { type: 'profileAdopt', platform: 'instagram' },
    { type: 'profileForget', platform: 'x' },
    { type: 'profileForget', platform: 'instagram' },
    { type: 'importExport' },
    { type: 'backupExport' },
    { type: 'backupRestore' },
    { type: 'dataFolderInfo' },
    { type: 'dataFolderOpen' },
  ];
  for (const method of methods) {
    const request = { ...method, requestId };
    expect(DesktopRequestSchema.parse(request)).toEqual(request);
    for (const extra of [
      { path: 'C:/generated' },
      { profile: 'C:/generated' },
      { executablePath: 'C:/generated/browser.exe' },
      { order: { acceptCanary: true } },
      { value: 'delete' },
    ])
      expect(
        DesktopRequestSchema.safeParse({ ...request, ...extra }).success,
      ).toBe(false);
  }
  for (const request of [
    {
      type: 'planRun',
      platform: 'instagram',
      mode: 'delete',
      accountKey: 'instagram:generated',
    },
    {
      type: 'planRun',
      platform: 'x',
      mode: 'context',
      accountKey: 'x:generated',
    },
    {
      type: 'planRun',
      platform: 'x',
      mode: 'fill',
      accountKey: 'instagram:generated',
    },
    {
      type: 'planRun',
      platform: 'x',
      mode: 'fill',
      accountKey: 'x:generated',
      handle: 'generated.invalid',
    },
    { type: 'profileAdopt', platform: 'x' },
    { type: 'startRun', planHash: 'not-a-hash', browser: 'edge' },
    { type: 'startRun', planHash: hash, browser: 'firefox' },
    { type: 'runAction', action: 'start', runId: 'generated-run', version: -1 },
    {
      type: 'runAction',
      action: 'approve',
      runId: 'generated-run',
      version: 1,
    },
  ])
    expect(
      DesktopRequestSchema.safeParse({ ...request, requestId }).success,
    ).toBe(false);
});

test('HTTP review requests retain their own strict checks and human-decision boundary', () => {
  const decide = {
    type: 'decide',
    requestId,
    commandId: 'c',
    itemIds: ['x:1'],
    value: 'delete',
    expected: { 'x:1': 'undecided' },
  };
  expect(DesktopRequestSchema.parse(decide)).toEqual(decide);
  for (const request of [
    { ...decide, expected: {} },
    { ...decide, itemIds: ['x:1', 'x:1'] },
    { ...decide, source: { kind: 'agent' } },
    { type: 'approve', requestId, itemId: 'x:1' },
    { type: 'restore', requestId, file: new Blob() },
    { type: 'backup', requestId, target: new WritableStream() },
    { type: 'attachImport', requestId, port: {} },
    { type: 'deleteWorkspace', requestId, workspaceId: 'generated' },
  ])
    expect(DesktopRequestSchema.safeParse(request).success).toBe(false);
});

test('all monitor phases parse with their required phase-specific evidence', () => {
  const base = running();
  const views = [
    { phase: 'idle', version: 0 },
    { ...base, phase: 'planning', planHash: null, warning: null },
    {
      ...base,
      phase: 'awaiting-warning',
      warning: { ...base.warning, acknowledged: false },
    },
    { ...base, phase: 'awaiting-start' },
    base,
    { ...base, phase: 'batch-pause', remainingMs: 900_000, until: time },
    { ...base, phase: 'rate-wait', remainingMs: 60_000, resetAt: time },
    {
      ...base,
      phase: 'reload-wait',
      remainingMs: 60_000,
      until: time,
      reload: 1,
    },
    { ...base, phase: 'paused', pausedAt: time },
    { ...base, phase: 'canary-review', canary: true },
    { ...base, phase: 'awaiting-continue', canary: true },
    { ...base, phase: 'ending', end: null },
    {
      ...base,
      phase: 'ended',
      end: { at: time, reason: 'done', detail: null, cliCode: null },
    },
  ];
  for (const view of views) expect(RunViewSchema.parse(view)).toEqual(view);
  expect(
    RunViewSchema.safeParse({
      ...base,
      xWindows: [
        {
          ...base.xWindows[0],
          operation: 'graphql-other',
          operationName: 'GeneratedOperationOne',
        },
        {
          ...base.xWindows[0],
          operation: 'graphql-other',
          operationName: 'GeneratedOperationTwo',
        },
      ],
    }).success,
  ).toBe(true);
  for (const phase of [
    'batch-pause',
    'rate-wait',
    'reload-wait',
    'paused',
    'ending',
    'ended',
  ])
    expect(RunViewSchema.safeParse({ ...base, phase }).success).toBe(false);
  expect(
    RunViewSchema.safeParse({ ...base, phase: 'canary-review' }).success,
  ).toBe(false);
  expect(
    RunViewSchema.safeParse({
      ...base,
      phase: 'awaiting-start',
      warning: { ...base.warning, acknowledged: false },
    }).success,
  ).toBe(false);
  for (const [mode, cap, action] of [
    ['delete', 200, 'delete-post'],
    ['verify', 100, 'verify'],
  ] as const) {
    const view = {
      ...base,
      mode,
      today: { ...base.today, cap },
      currentEntry: { ...base.currentEntry, action },
      journal: [],
    };
    expect(RunViewSchema.safeParse(view).success).toBe(true);
    expect(
      RunViewSchema.safeParse({
        ...view,
        today: { ...view.today, cap: cap + 1 },
      }).success,
    ).toBe(false);
  }
});

test('monitor bounds reject malformed nested data and keep counts, headers and profile read-back explicit', () => {
  const base = running();
  const instagram = {
    ...base,
    platform: 'instagram',
    mode: 'context',
    accountKey: 'instagram:generated',
    today: { ...base.today, unit: 'steps', sharedWithXDeleteAndFill: false },
    currentEntry: {
      ...base.currentEntry,
      kind: 'comment',
      action: 'confirm-comment',
    },
    journal: [
      { at: time, action: 'confirm-comment', outcome: 'confirmed', code: null },
    ],
    xWindows: [],
    instagram: {
      responses: [
        {
          host: 'instagram',
          path: 'graphql',
          count: 2,
          status4xx: { '429': 1 },
          status5xx: 0,
        },
      ],
      ready: {
        list: { count: 2, medianMs: 1.5, maxMs: 2 },
        post: { count: 0, medianMs: null, maxMs: null },
      },
      headerNames: ['retry-after', 'x-ratelimit-limit'],
    },
    profile: {
      ...base.profile,
      readback: {
        outcome: 'unchanged',
        profileObserved: true,
        accountBefore: 'generated',
        accountAfter: 'generated',
        extensionIdsBefore: [],
        extensionIdsAfter: [],
        extensionIdsAdded: [],
        extensionIdsRemoved: [],
        changedFiles: ['Default/History'],
        unexpectedRequests: [],
      },
    },
  };
  expect(RunViewSchema.parse(instagram)).toEqual(instagram);
  expect(
    RunViewSchema.safeParse({
      ...instagram,
      profile: {
        ...instagram.profile,
        readback: {
          ...instagram.profile.readback,
          outcome: 'not-completed',
          profileObserved: false,
          accountAfter: null,
        },
      },
    }).success,
  ).toBe(true);
  for (const patch of [
    { progress: { ...base.progress, planned: -1 } },
    { progress: { ...base.progress, completed: 3 } },
    {
      progress: {
        ...base.progress,
        settled: { ...base.progress.settled, sending: 1 },
      },
    },
    { journal: Array.from({ length: 11 }, () => base.journal[0]) },
    { journal: [{ ...base.journal[0], code: 'GENERATED_UNKNOWN' }] },
    { currentEntry: { ...base.currentEntry, firstLine: 'x'.repeat(10_001) } },
    {
      currentEntry: {
        ...base.currentEntry,
        firstLine: 'generated\nsecond line',
      },
    },
    { today: { ...base.today, cap: 601 } },
    { today: { ...base.today, used: 0.5 } },
    { today: { ...base.today, sharedWithXDeleteAndFill: false } },
    {
      xWindows: [
        { ...base.xWindows[0], operation: 'GeneratedUnknownOperation' },
      ],
    },
    {
      xWindows: [{ ...base.xWindows[0], remaining: Number.POSITIVE_INFINITY }],
    },
    { warning: { ...base.warning, text: 'x'.repeat(8193) } },
    { profile: { ...base.profile, extra: true } },
    { mode: 'context' },
  ])
    expect(RunViewSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  for (const patch of [
    { headerNames: ['retry-after: 30'] },
    { headerNames: ['set-cookie'] },
    { headerNames: ['x-ratelimit-limit'], headerValues: ['30'] },
    {
      responses: [
        {
          host: 'generated.example',
          path: 'graphql',
          count: 1,
          status4xx: {},
          status5xx: 0,
        },
      ],
    },
    {
      responses: [
        {
          host: 'instagram',
          path: 'graphql',
          count: 1,
          status4xx: { '200': 1 },
          status5xx: 0,
        },
      ],
    },
  ])
    expect(
      RunViewSchema.safeParse({
        ...instagram,
        instagram: { ...instagram.instagram, ...patch },
      }).success,
    ).toBe(false);
  expect(
    RunViewSchema.safeParse({ ...instagram, xWindows: base.xWindows }).success,
  ).toBe(false);
  expect(
    RunViewSchema.safeParse({
      ...instagram,
      profile: {
        ...instagram.profile,
        readback: { ...instagram.profile.readback, profileObserved: false },
      },
    }).success,
  ).toBe(false);
  for (const detail of ['generated-unknown', 'CANARY_MISMATCH suffix'])
    expect(
      RunViewSchema.safeParse({
        ...base,
        phase: 'ended',
        end: { at: time, reason: 'error', detail, cliCode: 'RUN_STOPPED' },
      }).success,
    ).toBe(false);
});

test('every new reply is strict and review reply batches retain their identity and terminal ordering', () => {
  const profile = {
    platform: 'x',
    exists: true,
    ready: true,
    inUse: false,
    browser: 'edge',
    canAdopt: false,
  };
  const replies = [
    {
      type: 'runPlanned',
      plan: {
        platform: 'x',
        mode: 'fill',
        accountKey: 'x:generated',
        expectedHandle: 'generated',
        planHash: hash,
        planned: 2,
        marked: 0,
        bulk: 0,
        estimateMs: 60_000,
        canary: true,
        rows: [running().currentEntry],
      },
    },
    { type: 'runStarted', view: running() },
    { type: 'runActionResult', view: running() },
    { type: 'runView', view: { phase: 'idle', version: 0 } },
    { type: 'browsersFound', browsers: ['edge', 'chrome'], preferred: 'edge' },
    { type: 'profileStatus', profile },
    { type: 'profileSetupResult', profile },
    {
      type: 'profileAdoptResult',
      profile: { ...profile, platform: 'instagram' },
    },
    {
      type: 'profileForgetResult',
      profile: { ...profile, exists: false, ready: false, browser: null },
    },
    {
      type: 'exportImported',
      result: {
        status: 'imported',
        items: 2,
        duplicates: 0,
        accounts: 1,
        partial: false,
      },
    },
    { type: 'exportImported', result: { status: 'cancelled' } },
    {
      type: 'backupExported',
      result: { status: 'exported', bytes: 100, mediaFiles: 0, mediaBytes: 0 },
    },
    { type: 'backupExported', result: { status: 'cancelled' } },
    { type: 'backupRestored', result: { status: 'restored', items: 2 } },
    { type: 'backupRestored', result: { status: 'cancelled' } },
    {
      type: 'dataFolderInfo',
      folder: {
        path: 'C:/generated/SocialPrune Data',
        storeBuild: false,
        folders: [{ kind: 'workspace', bytes: 100 }],
      },
    },
    { type: 'dataFolderOpened', opened: true },
    { type: 'desktopFailed', code: 'ENGINE_UNAVAILABLE' },
    { type: 'desktopFailed', code: 'WORKSPACE_BUSY' },
    { type: 'desktopFailed', code: 'INVALID_REQUEST' },
    {
      type: 'reviewReply',
      replies: [{ type: 'revision', requestId, revision: 1 }],
    },
    {
      type: 'reviewReply',
      replies: [
        { type: 'progress', requestId, completed: 0, total: 1 },
        { type: 'done', requestId },
      ],
    },
  ];
  for (const reply of replies) {
    expect(DesktopReplySchema.parse({ ...reply, requestId })).toEqual({
      ...reply,
      requestId,
    });
    expect(
      DesktopReplySchema.safeParse({ ...reply, requestId, extra: true })
        .success,
    ).toBe(false);
  }
  for (const reply of [
    {
      type: 'desktopFailed',
      code: 'UNKNOWN_GENERATED',
      message: 'Generated exception contents',
    },
    { type: 'browsersFound', browsers: ['edge', 'edge'], preferred: 'edge' },
    { type: 'browsersFound', browsers: [], preferred: 'edge' },
    { type: 'reviewReply', replies: [] },
    {
      type: 'reviewReply',
      replies: [{ type: 'done', requestId: 'different' }],
    },
    {
      type: 'reviewReply',
      replies: [{ type: 'progress', requestId, completed: 1, total: 1 }],
    },
    {
      type: 'reviewReply',
      replies: [
        { type: 'done', requestId },
        { type: 'done', requestId },
      ],
    },
    {
      type: 'dataFolderInfo',
      folder: { path: 'x'.repeat(32_768), storeBuild: false, folders: [] },
    },
  ])
    expect(DesktopReplySchema.safeParse({ ...reply, requestId }).success).toBe(
      false,
    );
  expect(
    parseDesktopReply(
      { type: 'runView', requestId },
      { type: 'runView', requestId, view: { phase: 'idle', version: 0 } },
    ).type,
  ).toBe('runView');
  expect(
    parseDesktopReply(
      { type: 'runView', requestId },
      { type: 'desktopFailed', requestId, code: 'ENGINE_UNAVAILABLE' },
    ).type,
  ).toBe('desktopFailed');
  expect(
    parseDesktopReply(
      { type: 'revision', requestId },
      {
        type: 'reviewReply',
        requestId,
        replies: [{ type: 'revision', requestId, revision: 0 }],
      },
    ).type,
  ).toBe('reviewReply');
  expect(() =>
    parseDesktopReply(
      { type: 'runView', requestId },
      { type: 'dataFolderOpened', requestId, opened: true },
    ),
  ).toThrow('Desktop reply method');
  expect(() =>
    parseDesktopReply(
      { type: 'runView', requestId },
      {
        type: 'runView',
        requestId: 'different',
        view: { phase: 'idle', version: 0 },
      },
    ),
  ).toThrow('Desktop reply method');
});

test('the public desktop protocol subpath resolves without Node, CLI or writer capability', async () => {
  expect(
    import.meta.resolve('@socialprune/core/workspace/desktop-protocol'),
  ).toBe(new URL('./desktop-protocol.ts', import.meta.url).href);
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1/g,
    )) {
      const specifier = match[2]!;
      expect(specifier, path).not.toMatch(
        /node:|apps\/cli|writer|workspace\/review/,
      );
      if (specifier.startsWith('.'))
        await visit(resolve(dirname(path), specifier));
    }
  };
  await visit(fileURLToPath(new URL('./desktop-protocol.ts', import.meta.url)));
  expect(visited.size).toBeGreaterThan(3);
});
