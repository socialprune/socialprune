import { expect, test } from 'vitest';
import {
  BrowserRunSchema,
  BrowserAttemptSchema,
  validateBrowserOutcomes,
  validateBrowserRunUpdate,
} from './browser.ts';
import { WORKSPACE_SCHEMA_VERSION, OutcomeEventSchema } from './index.ts';

const run = {
  runId: 'ig-delete',
  platform: 'instagram',
  accountKey: 'instagram:generated',
  mode: 'delete',
  planHash: 'a'.repeat(64),
  startedAt: '2026-10-25T12:00:00.000Z',
  endedAt: '2026-10-25T12:01:00.000Z',
  endReason: 'canary',
  canaryAcceptedAt: '2026-10-25T12:01:00.000Z',
  bodyShapes: {},
  profileReport: null,
};
test('D10 schema 10 admits Instagram deletion and its own outcome source, not an X warning on Instagram', () => {
  expect(WORKSPACE_SCHEMA_VERSION).toBe(12);
  expect(BrowserRunSchema.safeParse(run).success).toBe(true);
  expect(
    BrowserRunSchema.safeParse({ ...run, warningKind: 'http-429' }).success,
  ).toBe(false);
  expect(BrowserRunSchema.safeParse({ ...run, mode: 'fill' }).success).toBe(
    false,
  );
  expect(
    BrowserRunSchema.safeParse({
      ...run,
      platform: 'x',
      accountKey: 'x:generated',
      mode: 'context',
    }).success,
  ).toBe(false);
  expect(
    OutcomeEventSchema.safeParse({
      eventId: 'event',
      seq: 1,
      itemId: 'instagram:1',
      previous: 'unknown',
      value: 'deleted-via-browser',
      recordedAt: run.endedAt,
      source: { kind: 'human', via: 'browser-instagram' },
      action: { id: 'settlement', kind: 'single', size: 1, reverts: null },
    }).success,
  ).toBe(true);
});
test('D10 write-once runs allow only a single page increment, first warning, finalization and checked canary acceptance', () => {
  const active = BrowserRunSchema.parse({
    ...run,
    endedAt: null,
    endReason: null,
    canaryAcceptedAt: null,
    pageOpens: 0,
    pageDays: {},
    pageZone: 'UTC',
  });
  const step = BrowserRunSchema.parse({
    ...active,
    pageOpens: 1,
    lastPageOpenedAt: active.startedAt,
    pageDays: { '2026-10-25': 1 },
  });
  expect(() => validateBrowserRunUpdate(active, step)).not.toThrow();
  expect(() =>
    validateBrowserRunUpdate(active, {
      ...step,
      pageDays: { '2026-10-24': 1 },
    }),
  ).toThrow();
  expect(() =>
    validateBrowserRunUpdate(step, {
      ...step,
      pageOpens: 2,
      pageDays: { '2026-10-25': 2 },
      accountKey: 'instagram:foreign',
    }),
  ).toThrow();
  const warned = BrowserRunSchema.parse({
    ...step,
    instagramWarning: { kind: 'http-429', at: active.startedAt, zone: 'UTC' },
  });
  expect(() => validateBrowserRunUpdate(step, warned)).not.toThrow();
  expect(() => validateBrowserRunUpdate(warned, step)).toThrow();
  const ended = BrowserRunSchema.parse({
    ...warned,
    endedAt: active.startedAt,
    endReason: 'platform-check',
  });
  expect(() => validateBrowserRunUpdate(warned, ended)).not.toThrow();
  expect(() =>
    validateBrowserRunUpdate(ended, { ...ended, bodyShapes: { changed: [] } }),
  ).toThrow();
});
test('D10 comment outcomes cannot borrow an X receipt or a mismatching platform source', () => {
  const attempt = {
    seq: 1,
    attemptId: 'settlement',
    runId: run.runId,
    itemId: 'instagram:1',
    action: 'delete-comment',
    state: 'deleted',
    settles: 'sending',
    at: run.endedAt,
    code: null,
  };
  expect(BrowserAttemptSchema.safeParse(attempt).success).toBe(true);
  const event = {
    itemId: 'instagram:1',
    value: 'deleted-via-browser',
    source: { via: 'browser-instagram' },
    action: { id: 'settlement' },
  };
  expect(() =>
    validateBrowserOutcomes([attempt as never], [event]),
  ).not.toThrow();
  expect(() =>
    validateBrowserOutcomes(
      [attempt as never],
      [{ ...event, source: { via: 'browser-x' } }],
    ),
  ).toThrow();
});
