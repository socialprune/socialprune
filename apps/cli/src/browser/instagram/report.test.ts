import { expect, test } from 'vitest';
import { contextCause, ContextCauseSchema, stopDetails } from './report.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

const runId = '00000000-0000-4000-8000-000000000016';
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
    expect(stopDetails(error)).toEqual({ code: token, token });
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
