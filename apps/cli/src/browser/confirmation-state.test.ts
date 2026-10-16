import { expect, test } from 'vitest';
import { RunViewSchema } from '@socialprune/core/workspace/desktop-protocol';
import type { RunView } from '@socialprune/core/workspace/desktop-protocol';
import {
  ConfirmationState,
  profileReadback,
  rateWindow,
} from './confirmation-state.ts';
import { entryView } from './run-session.ts';
import { FIXTURE, fixtureWorkspace } from '../../e2e/fake-x/fixture.ts';
import { CliError } from '../cli/errors.ts';

function state() {
  const desktop = {
    phase: 'awaiting-warning',
    version: 1,
    runId: 'generated-run',
    platform: 'x',
    mode: 'delete',
    accountKey: FIXTURE.account.key,
    expectedHandle: FIXTURE.account.handle,
    planHash: 'a'.repeat(64),
    canary: true,
    pauseRequested: false,
    progress: {
      planned: 4,
      completed: 0,
      marked: 4,
      bulk: 2,
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
      used: 0,
      cap: 200,
      unit: 'pages',
      sharedWithXDeleteAndFill: true,
    },
    pace: { secondsPerStep: 30, batchSize: 20, batchPauseMs: 900000 },
    nextStepAt: null,
    currentEntry: null,
    journal: [],
    xWindows: [],
    instagram: null,
    warning: {
      form: 'full',
      acknowledged: false,
      text: 'Generated platform warning',
    },
    profile: {
      canChange: ['Generated dedicated profile'],
      before: null,
      readback: null,
    },
    browserWindow: null,
  } satisfies RunView;
  const owner = new ConfirmationState(
    {
      phase: 'start',
      warning: 'Generated platform warning',
      profileWarning: 'Generated profile',
      planned: 4,
      bulk: 2,
      estimateMs: 90000,
      list: 'generated',
      rows: [],
      completed: 0,
      result: '',
    },
    desktop,
  );
  const controls = { requestPause() {}, resume() {}, stop() {} };
  const act = (action: Parameters<typeof owner.action>[2]) => {
    const view = owner.runView;
    if (view.phase !== 'idle')
      owner.action(view.runId, view.version, action, controls);
  };
  return { owner, controls, act };
}
test('stale versions and foreign run IDs cannot confirm a later step', () => {
  const { owner, controls, act } = state();
  const stale = owner.runView;
  act('acknowledge-warning');
  void owner.wait('start');
  expect(() =>
    owner.action('generated-run', stale.version, 'start', controls),
  ).toThrow(CliError);
  expect(() =>
    owner.action(
      'foreign-generated-run',
      owner.runView.version,
      'start',
      controls,
    ),
  ).toThrow(CliError);
  expect(owner.runView.phase).toBe('awaiting-start');
});
test('Start needs acknowledgement, and watched steps need the person’s Continue rather than automatic acceptance', async () => {
  const { owner, act } = state();
  let starts = 0,
    matches = 0;
  const start = owner.wait('start').then((value) => {
    if (value) starts++;
  });
  expect(() => act('start')).toThrow(CliError);
  expect(starts).toBe(0);
  act('acknowledge-warning');
  act('start');
  await start;
  expect(starts).toBe(1);
  owner.update({ phase: 'canary', completed: 1 });
  const continuing = owner.wait('continue').then((value) => {
    if (value) matches++;
  });
  await Promise.resolve();
  expect(matches).toBe(0);
  expect(() => act('matches')).toThrow(CliError);
  expect(() => act('does-not-match')).toThrow(CliError);
  act('continue');
  await continuing;
  expect(matches).toBe(1);
  expect(RunViewSchema.safeParse(owner.runView).success).toBe(true);
});
test('unobserved Instagram account read-back is not-completed, never unchanged', () => {
  const input = {
    profileObserved: true,
    accountBefore: null,
    accountAfter: null,
    extensionIdsBefore: [],
    extensionIdsAfter: [],
    extensionIdsAdded: [],
    extensionIdsRemoved: [],
    changedFiles: [],
    unexpectedRequests: [],
  };
  expect(profileReadback(input).outcome).toBe('not-completed');
  expect(
    profileReadback({
      ...input,
      accountBefore: 'generated',
      accountAfter: 'generated',
    }).outcome,
  ).toBe('unchanged');
  expect(
    profileReadback({
      ...input,
      profileObserved: false,
      accountBefore: 'generated',
      accountAfter: 'generated',
    }).outcome,
  ).toBe('not-completed');
});
test('a watched step cannot continue itself while the person has not clicked Continue', async () => {
  const { owner, act } = state();
  void owner.wait('start');
  act('acknowledge-warning');
  act('start');
  owner.update({ phase: 'canary', completed: 1 });
  let accepted = false;
  const continuation = owner.wait('continue').then((value) => {
    accepted = value;
  });
  await Promise.resolve();
  expect(accepted).toBe(false);
  expect(owner.runView.phase).toBe('awaiting-continue');
  act('continue');
  await continuation;
  expect(accepted).toBe(true);
});
test('the final canary waits for Matches and permits Does not match only in canary-review', async () => {
  const { owner, act } = state();
  act('acknowledge-warning');
  owner.update({ phase: 'match' });
  let accepted: boolean | undefined;
  const pending = owner.wait('matches').then((value) => {
    accepted = value;
  });
  await Promise.resolve();
  expect(accepted).toBeUndefined();
  expect(() => act('continue')).toThrow(CliError);
  act('does-not-match');
  await pending;
  expect(accepted).toBe(false);
});
test('first-line truncation truth and unknown X operation identities are preserved', () => {
  const item = fixtureWorkspace().items[0]!;
  expect(entryView(item, 'delete-post')).toMatchObject({
    firstLine: FIXTURE.rows[0].text.split('\n')[0],
    textTruncated: true,
  });
  expect(
    entryView({ ...item, text: 'Generated single line' }, 'delete-post')
      .textTruncated,
  ).toBe(false);
  expect(
    rateWindow('GeneratedNewQuery', 50, 24, Date.parse(FIXTURE.now)),
  ).toEqual({
    operation: 'graphql-other',
    operationName: 'GeneratedNewQuery',
    limit: 50,
    remaining: 24,
    resetAt: FIXTURE.now,
  });
});

test('Stop accepts an older version in every active phase but rejects a foreign run', async () => {
  const phases = [
    { phase: 'awaiting-warning' },
    { phase: 'awaiting-start' },
    { phase: 'running' },
    { phase: 'batch-pause', remainingMs: 900000, until: FIXTURE.now },
    { phase: 'rate-wait', remainingMs: 900000, resetAt: FIXTURE.now },
    {
      phase: 'reload-wait',
      remainingMs: 60000,
      until: FIXTURE.now,
      reload: 1,
      canary: false,
    },
    { phase: 'paused', pausedAt: FIXTURE.now },
    { phase: 'canary-review' },
    { phase: 'awaiting-continue' },
    { phase: 'ending', end: null },
  ];
  for (const phase of phases) {
    const { owner, controls, act } = state();
    if (phase.phase !== 'awaiting-warning') {
      act('acknowledge-warning');
      owner.updateRun({
        ...phase,
        ...(phase.phase === 'rate-wait' || phase.phase === 'reload-wait'
          ? { mode: 'fill' }
          : {}),
      });
    }
    const pending = owner.wait('start');
    expect(() =>
      owner.action(
        'foreign-generated-run',
        owner.runView.version - 1,
        'stop',
        controls,
      ),
    ).toThrow(CliError);
    owner.action('generated-run', owner.runView.version - 1, 'stop', controls);
    expect(await pending).toBe(false);
    expect(owner.stopped).toBe(true);
    expect(owner.runView.phase).toBe('ending');
  }
});

test('every mode uses the CLI Continue button and requires exact pending-action identity', async () => {
  for (const mode of ['delete', 'verify', 'fill', 'context'] as const) {
    const { owner, act } = state();
    act('acknowledge-warning');
    owner.updateRun({
      mode,
      ...(mode === 'verify'
        ? {
            today: {
              date: '2026-10-16',
              timeZone: 'Europe/Berlin',
              used: 0,
              cap: 100,
              unit: 'pages',
              sharedWithXDeleteAndFill: true,
            },
          }
        : mode === 'context'
          ? {
              platform: 'instagram',
              accountKey: 'instagram:generated',
              today: {
                date: '2026-10-16',
                timeZone: 'Europe/Berlin',
                used: 0,
                cap: 200,
                unit: 'steps',
                sharedWithXDeleteAndFill: false,
              },
            }
          : {}),
    });
    owner.update({ phase: 'canary' });
    const pending = owner.wait('continue');
    expect(() => act('matches')).toThrow(CliError);
    expect(() => act('does-not-match')).toThrow(CliError);
    act('continue');
    expect(await pending).toBe(true);
    owner.update({ phase: 'match' });
    const accepted = owner.wait('matches');
    expect(() => act('continue')).toThrow(CliError);
    act('matches');
    expect(await accepted).toBe(true);
  }
});
