import { RunViewSchema } from '@socialprune/core/workspace/desktop-protocol';
import type { RunView } from '@socialprune/core/workspace/desktop-protocol';
import { readFile } from 'node:fs/promises';
import type { Item } from '@socialprune/core';

const expected = JSON.parse(
  await readFile(
    new URL(
      '../../../../fixtures/synthetic/demo/x/expected.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { items: Item[] };
export const ownEntry = expected.items[0]!;
export const allPhases = RunViewSchema.options.map(
  (option) => option.shape.phase.value,
);
export function runView(
  phase: RunView['phase'],
  version = 1,
  overrides: Record<string, unknown> = {},
): RunView {
  const now = Date.now();
  const base = {
    phase,
    version,
    runId: 'generated-desktop-run',
    platform: 'x',
    mode: 'fill',
    accountKey: ownEntry.account.key,
    expectedHandle: ownEntry.account.handle,
    planHash: 'a'.repeat(64),
    canary: phase === 'canary-review' || phase === 'awaiting-continue',
    pauseRequested: false,
    progress: {
      planned: 20,
      completed: 3,
      marked: 20,
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
        read: 3,
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
      used: 12,
      cap: 200,
      unit: 'pages',
      sharedWithXDeleteAndFill: true,
    },
    pace: { secondsPerStep: 30, batchSize: 20, batchPauseMs: 900000 },
    nextStepAt: new Date(now + 30000).toISOString(),
    currentEntry: {
      kind: ownEntry.kind,
      date: ownEntry.createdAt,
      firstLine: ownEntry.text.split('\n')[0],
      textTruncated: true,
      action: 'read-post',
    },
    journal: [
      {
        at: new Date(now).toISOString(),
        action: 'read-post',
        outcome: 'read',
        code: null,
      },
    ],
    xWindows: [
      {
        operation: 'TweetDetail',
        operationName: null,
        limit: 50,
        remaining: 37,
        resetAt: new Date(now + 60000).toISOString(),
      },
    ],
    instagram: null,
    warning: {
      form: 'full',
      acknowledged: phase !== 'awaiting-warning',
      text: 'Generated warning for the desktop fixture.',
    },
    profile: {
      canChange: [
        'Cookies, site data, cache and browser history.',
        'Browser preferences, extension state and the local profile read-back record.',
      ],
      before: { account: ownEntry.account.handle, extensionIds: [] },
      readback: null,
    },
    browserWindow: { browser: 'edge', placement: 'beside' },
  };
  const extra =
    phase === 'idle'
      ? {}
      : phase === 'batch-pause'
        ? { remainingMs: 60000, until: new Date(now + 60000).toISOString() }
        : phase === 'rate-wait'
          ? { remainingMs: 60000, resetAt: new Date(now + 60000).toISOString() }
          : phase === 'reload-wait'
            ? {
                remainingMs: 60000,
                until: new Date(now + 60000).toISOString(),
                reload: 1,
              }
            : phase === 'paused'
              ? { pausedAt: new Date(now).toISOString() }
              : phase === 'ending'
                ? { end: null }
                : phase === 'ended'
                  ? {
                      end: {
                        at: new Date(now).toISOString(),
                        reason: 'done',
                        detail: null,
                        cliCode: null,
                      },
                    }
                  : {};
  return RunViewSchema.parse(
    phase === 'idle' ? { phase, version } : { ...base, ...extra, ...overrides },
  );
}

export function instagramView(version: number) {
  return runView('running', version, {
    platform: 'instagram',
    mode: 'context',
    accountKey: 'instagram:generated',
    expectedHandle: 'demo_fern',
    today: {
      date: '2026-10-16',
      timeZone: 'Europe/Berlin',
      used: 15,
      cap: 200,
      unit: 'steps',
      sharedWithXDeleteAndFill: false,
    },
    currentEntry: {
      kind: 'comment',
      date: ownEntry.createdAt,
      firstLine: 'Generated comment for a post.',
      textTruncated: false,
      action: 'confirm-comment',
    },
    journal: [
      {
        at: new Date().toISOString(),
        action: 'confirm-comment',
        outcome: 'confirmed',
        code: null,
      },
    ],
    xWindows: [],
    instagram: {
      responses: [
        {
          host: 'instagram',
          path: 'post-page',
          count: 4,
          status4xx: { '404': 1 },
          status5xx: 0,
        },
      ],
      ready: {
        list: { count: 2, medianMs: 100.5, maxMs: 201 },
        post: { count: 1, medianMs: 300, maxMs: 300 },
      },
      headerNames: ['x-ratelimit-remaining', 'retry-after'],
    },
  });
}
