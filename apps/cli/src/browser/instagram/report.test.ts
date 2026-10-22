import { expect, test } from 'vitest';
import {
  contextCause,
  ContextCauseSchema,
  stopDetails,
  ContextStop,
  AccountCheckSchema,
  AccountReadbackSchema,
  accountClass,
  stopDetailText,
  errorClass,
  RuntimeReportSchema,
} from './report.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

const runId = '00000000-0000-4000-8000-000000000016';
test.each([
  ['TargetClosedError', 'target-closed'],
  ['TargetClosedError2', 'target-closed'],
  ['PageCrashedError', 'page-crashed'],
  ['TimeoutError', 'timeout'],
  ['NavigationError', 'navigation'],
  ['ProtocolError', 'protocol'],
  ['Error', 'other'],
] as const)(
  'C21 exact error type or name %s maps to %s without inspecting private properties',
  (name, expected) => {
    const failure = new Error();
    failure.name = name;
    for (const key of ['message', 'stack'])
      Object.defineProperty(failure, key, {
        get() {
          throw new Error('private property read');
        },
      });
    expect(errorClass(failure)).toBe(expected);
    class TargetClosedError extends Error {}
    expect(errorClass(new TargetClosedError(IG_FIXTURE.other.text))).toBe(
      'target-closed',
    );
  },
);
test('C21 unexpected errors retain a closed class in cause stop and terminal while tokens stay unchanged', () => {
  const failure = new Error(IG_FIXTURE.other.text);
  failure.name = 'PageCrashedError';
  expect(contextCause(failure, runId, 'post-read', 4)).toMatchObject({
    token: 'unexpected-error',
    errorClass: 'page-crashed',
  });
  expect(stopDetails(failure)).toEqual({
    code: 'unexpected-error',
    token: 'unexpected-error',
    errorClass: 'page-crashed',
  });
  expect(stopDetailText(failure)).toBe(
    'unexpected-error; errorClass=page-crashed',
  );
  expect(stopDetails(new Error(IG_FIXTURE.other.text))).toMatchObject({
    token: 'unexpected-error',
    errorClass: 'other',
  });
  const zero = {
    pageCrashes: 0,
    browserDisconnects: 0,
    unexpectedPageCloses: 0,
    browserObserved: false,
    observationFailed: false,
    events: [],
  };
  expect(RuntimeReportSchema.parse(zero)).toEqual(zero);
  for (const invalid of [
    { ...zero, url: IG_FIXTURE.other.code },
    { ...zero, pageCrashes: -1 },
    {
      ...zero,
      events: [
        { event: IG_FIXTURE.other.text, step: 1, stage: 'post-read', count: 1 },
      ],
    },
  ])
    expect(() => RuntimeReportSchema.parse(invalid)).toThrow();
});
test('C20 account-check evidence survives the stop and terminal formatter as closed fields only', () => {
  const accountCheck = {
    profileLinkFound: false,
    outsidePathCount: 0,
    rows: 5,
    ownRows: 5,
    elapsedMs: 17052,
    reads: 9,
    lastReadAfterDeadline: false,
  };
  const error = new ContextStop(
    'ACCOUNT_MISMATCH',
    'account-changed',
    accountCheck,
  );
  expect(stopDetails(error)).toEqual({
    code: 'ACCOUNT_MISMATCH',
    token: 'account-changed',
    accountCheck,
  });
  expect(stopDetailText(error)).toBe(
    'account-changed; link=false; outsidePathCount=0; rows=5; own=5; reads=9; elapsedMs=17052; lastReadAfterDeadline=false',
  );
  for (const value of Object.values(IG_FIXTURE.other))
    expect(
      JSON.stringify(stopDetails(error)) + stopDetailText(error),
    ).not.toContain(value);
  expect(
    stopDetailText(new ContextStop('PLATFORM_CHECK', 'notice-error')),
  ).toBe('notice-error');
});
test('C20 account-check schema rejects private fields and inconsistent counts', () => {
  const valid = {
    profileLinkFound: true,
    outsidePathCount: 1,
    rows: 5,
    ownRows: 2,
    elapsedMs: 1,
    reads: 1,
    lastReadAfterDeadline: true,
  };
  expect(AccountCheckSchema.parse(valid)).toEqual(valid);
  for (const value of [
    { ...valid, username: IG_FIXTURE.other.username },
    { ...valid, paths: [`/${IG_FIXTURE.other.username}/`] },
    { ...valid, ownRows: 6 },
    { ...valid, reads: 0 },
    { ...valid, elapsedMs: -1 },
    { ...valid, rows: 1.5 },
    { ...valid, profileLinkFound: IG_FIXTURE.other.text },
  ])
    expect(() => AccountCheckSchema.parse(value)).toThrow();
});
test('C20 readback account classes distinguish expected absent and other without names', () => {
  const expected = 'generated_c20_person';
  expect(accountClass(expected, [`/${expected.toUpperCase()}/`])).toBe(
    'expected',
  );
  expect(accountClass(expected, [])).toBe('absent');
  expect(
    accountClass(expected, [
      '/your_activity/interactions/comments',
      '/p/generated/',
    ]),
  ).toBe('absent');
  expect(accountClass(expected, [`/${IG_FIXTURE.other.username}/`])).toBe(
    'other',
  );
  expect(
    AccountReadbackSchema.parse({
      accountBeforeClass: 'expected',
      accountAfterClass: 'absent',
    }),
  ).toEqual({ accountBeforeClass: 'expected', accountAfterClass: 'absent' });
  for (const value of [
    { accountBeforeClass: expected, accountAfterClass: 'absent' },
    {
      accountBeforeClass: 'other',
      accountAfterClass: IG_FIXTURE.other.username,
    },
    {
      accountBeforeClass: 'expected',
      accountAfterClass: 'other',
      username: expected,
    },
  ])
    expect(() => AccountReadbackSchema.parse(value)).toThrow();
});
test('C16 unexpected error retains a correlated closed cause chain without its values', () => {
  const timeout = new Error(IG_FIXTURE.other.text);
  timeout.name = 'TimeoutError';
  const error = new Error(IG_FIXTURE.other.username, { cause: timeout });
  const cause = contextCause(error, runId, 'list-read', 3);
  expect(cause).toEqual({
    runId,
    stage: 'list-read',
    step: 3,
    token: 'browser-timeout',
    chain: ['unexpected-error', 'browser-timeout'],
  });
  for (const value of Object.values(IG_FIXTURE.other))
    expect(JSON.stringify(cause)).not.toContain(value);
});
test.each([
  [new TypeError(IG_FIXTURE.other.text), 'type-error'],
  [new RangeError(IG_FIXTURE.other.text), 'range-error'],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), { code: 'EBUSY' }),
    'fs-EBUSY',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), { code: 'EADDRINUSE' }),
    'socket-EADDRINUSE',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
    }),
    'sqlite-busy',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 1,
    }),
    'sqlite-error',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), {
      name: 'TargetClosedError',
    }),
    'browser-closed',
  ],
  [new Error(IG_FIXTURE.other.text), 'unexpected-error'],
  [IG_FIXTURE.other.text, 'unexpected-value'],
])(
  'C16 cause classification is closed for generated error %j',
  (error, token) => {
    expect(contextCause(error, runId, 'capture', 1).token).toBe(token);
    expect(stopDetails(error)).toEqual({
      code: token,
      token,
      ...(token === 'unexpected-error' ? { errorClass: 'other' } : {}),
    });
  },
);
test('C16 cause gate refuses arbitrary fields tokens stages and correlators', () => {
  const cause = {
    runId,
    stage: 'list-read',
    step: 1,
    token: 'unexpected-error',
    chain: ['unexpected-error'],
  };
  expect(ContextCauseSchema.parse(cause)).toEqual(cause);
  for (const value of [
    { ...cause, message: IG_FIXTURE.other.text },
    { ...cause, token: IG_FIXTURE.other.username },
    { ...cause, stage: IG_FIXTURE.other.code },
    { ...cause, runId: IG_FIXTURE.other.code },
    { ...cause, chain: [IG_FIXTURE.other.text] },
    { ...cause, step: -1 },
  ])
    expect(() => ContextCauseSchema.parse(value)).toThrow();
});
test('C16 cause traversal bounds depth and cycles without serializing a message or arbitrary code', () => {
  const error = new Error(IG_FIXTURE.other.text, { cause: undefined });
  error.cause = error;
  expect(contextCause(error, runId, 'run', 0).chain).toEqual([
    'unexpected-error',
  ]);
  let nested: unknown = Object.assign(new Error(IG_FIXTURE.other.text), {
    code: IG_FIXTURE.other.code,
  });
  for (let i = 0; i < 10; i++)
    nested = new Error(IG_FIXTURE.other.username, { cause: nested });
  const result = contextCause(nested, runId, 'capture', 3);
  expect(result.chain).toHaveLength(4);
  for (const value of Object.values(IG_FIXTURE.other))
    expect(JSON.stringify(result)).not.toContain(value);
});
