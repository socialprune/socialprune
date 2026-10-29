import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  readContextOrder,
  validateContextOrder,
  ContextOrderSchema,
} from './order.ts';

test('P1 pace order accepts the upper scoped limits and retains defaults without the new fields', () => {
  const base = {
    scope: 'context-instagram',
    account: 'generated_person',
    givenAt: '2026-10-15T12:00:00.000Z',
    words: 'Read the generated scope.',
  };
  expect(
    ContextOrderSchema.parse({
      ...base,
      secondsPerStep: 10,
      stepsPerDay: 600,
      maxSteps: 600,
      batchPause: false,
    }),
  ).toMatchObject({
    secondsPerStep: 10,
    stepsPerDay: 600,
    maxSteps: 600,
    batchPause: false,
  });
  expect(ContextOrderSchema.parse(base)).toMatchObject({
    batchPause: true,
    acceptCanary: false,
  });
  for (const fields of [
    { secondsPerStep: 9 },
    { secondsPerStep: 31 },
    { secondsPerStep: 10.5 },
    { stepsPerDay: 601 },
    { stepsPerDay: 0 },
    { stepsPerDay: 5.5 },
    { maxSteps: 601 },
    { batchPause: 'false' },
  ])
    expect(ContextOrderSchema.safeParse({ ...base, ...fields }).success).toBe(
      false,
    );
});

test.each([false, true])(
  'F2 explicit likes order is bound to run mode=%s while absent covers both',
  (mode) => {
    const base = {
      value: {
        scope: 'context-instagram' as const,
        account: 'generated_person',
        givenAt: '2026-10-26T00:00:00Z',
        words: 'Generated scope.',
        acceptCanary: true,
      },
      sha256: 'a'.repeat(64),
    };
    expect(() =>
      validateContextOrder(base, base.value.account, false, mode),
    ).not.toThrow();
    expect(() =>
      validateContextOrder(
        { ...base, value: { ...base.value, refreshLikes: mode } },
        base.value.account,
        false,
        mode,
      ),
    ).not.toThrow();
    expect(() =>
      validateContextOrder(
        { ...base, value: { ...base.value, refreshLikes: !mode } },
        base.value.account,
        false,
        mode,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_ORDER_INVALID' }));
  },
);
test('IG-list diagnostic order is bounded to one 30-second reading step, never likes refresh', () => {
  const order = {
    value: {
      scope: 'context-instagram' as const,
      account: 'generated_person',
      givenAt: '2026-10-29T12:00:00Z',
      words: 'Read one generated list only.',
      acceptCanary: true,
      listDiagnostic: true,
      maxSteps: 1,
      secondsPerStep: 30,
    },
    sha256: 'a'.repeat(64),
  };
  expect(() =>
    validateContextOrder(order, order.value.account, true),
  ).not.toThrow();
  for (const fields of [
    { maxSteps: 2 },
    { maxSteps: undefined },
    { secondsPerStep: 10 },
  ])
    expect(() =>
      validateContextOrder(
        { ...order, value: { ...order.value, ...fields } },
        order.value.account,
        true,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_ORDER_INVALID' }));
  expect(() =>
    validateContextOrder(order, order.value.account, false, true),
  ).toThrow(expect.objectContaining({ code: 'CONTEXT_ORDER_INVALID' }));
});

test.each([{ secondsPerStep: 9 }, { stepsPerDay: 601 }])(
  'P1 refuses out-of-range order %j independently',
  (fields) => {
    expect(
      ContextOrderSchema.safeParse({
        scope: 'context-instagram',
        account: 'generated_person',
        givenAt: '2026-10-15T12:00:00.000Z',
        words: 'Generated scope.',
        ...fields,
      }).success,
    ).toBe(false);
  },
);
test('strict UTF-8, exact scope, account, date, words, size and plan guards refuse before a browser capability', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-ig-order-')),
    path = join(directory, 'order.json'),
    hash = 'a'.repeat(64);
  const valid = {
    scope: 'context-instagram',
    account: 'generated_person',
    givenAt: '2026-10-15T12:00:00.000Z',
    words: 'Read this exact generated scope.',
  };
  try {
    const bytes = JSON.stringify(valid);
    await writeFile(path, bytes);
    const order = await readContextOrder(
      path,
      valid.account.toUpperCase(),
      hash,
      hash,
    );
    expect(order.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(order.value.acceptCanary).toBe(false);
    expect(() => validateContextOrder(order, valid.account, true)).toThrow(
      'Accept a watched',
    );
    expect(() =>
      validateContextOrder(order, valid.account, false),
    ).not.toThrow();
    for (const value of [
      { ...valid, scope: 'delete-x' },
      { ...valid, scope: 'context-instagram-more' },
      { ...valid, account: 'other' },
      { ...valid, givenAt: 'yesterday' },
      { ...valid, words: ' ' },
      { ...valid, maxSteps: 601 },
      { ...valid, acceptCanary: 'true' },
      { ...valid, extra: true },
    ]) {
      await writeFile(path, JSON.stringify(value));
      await expect(
        readContextOrder(path, valid.account, hash, hash),
      ).rejects.toMatchObject({ code: 'CONTEXT_ORDER_INVALID' });
    }
    await writeFile(path, Buffer.from([0xff, 0xfe]));
    await expect(
      readContextOrder(path, valid.account, hash, hash),
    ).rejects.toMatchObject({ code: 'CONTEXT_ORDER_INVALID' });
    await writeFile(path, ' '.repeat(65537));
    await expect(
      readContextOrder(path, valid.account, hash, hash),
    ).rejects.toMatchObject({ code: 'CONTEXT_ORDER_INVALID' });
    await expect(
      readContextOrder(path, valid.account, 'b'.repeat(64), hash),
    ).rejects.toMatchObject({ code: 'STALE_PLAN' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
