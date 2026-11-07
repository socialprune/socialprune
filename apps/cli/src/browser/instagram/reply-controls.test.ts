import { expect, test } from 'vitest';
import { replyControlShape, checkedReplyControls } from './reply-controls.ts';
import type { Locator } from 'playwright-core';
import { ReplyControlsDiagnosticSchema } from './report.ts';
test.each(['View all 5 replies', 'View replies (5)'])(
  'REPCTL exact %s needs matching explicit answer count',
  (label) => {
    expect(replyControlShape(label, 5)).toMatchObject({
      accepted: true,
      numberEqualsAnswer: true,
      digitsPresent: true,
    });
    expect(replyControlShape(label, 4)).toMatchObject({
      accepted: false,
      numberEqualsAnswer: false,
    });
    expect(replyControlShape(label, null).accepted).toBe(false);
  },
);
test.each([
  'View all 05 replies',
  'View all 5 replies now',
  'View 5 replies',
  'Hide replies',
  'See more replies',
  'Load replies',
  'View all 0 replies',
  'View replies (5000000)',
])('REPCTL unknown or non-expansion shape %s refuses', (label) => {
  expect(replyControlShape(label, 5).accepted).toBe(false);
});
test('REPCTL closed diagnostics contain no label and reject extra contents', () => {
  const value = {
    count: 1,
    capped: false,
    controls: [
      {
        ...replyControlShape('View all 5 replies', 5),
        tag: 'button',
        role: null,
      },
    ],
  };
  expect(ReplyControlsDiagnosticSchema.safeParse(value).success).toBe(true);
  expect(JSON.stringify(value)).not.toContain('View all');
  expect(
    ReplyControlsDiagnosticSchema.safeParse({
      ...value,
      label: 'Generated private label',
    }).success,
  ).toBe(false);
});
test('REPLYUL hide is inert only after expansion and unknown controls still refuse', async () => {
  for (const label of [
    'Hide replies',
    'Hide replies (5)',
    'Hide replies now',
    'See replies',
  ]) {
    const control = {
      innerText: () => Promise.resolve(label),
      getAttribute: () => Promise.resolve('button'),
      locator: () => ({ count: () => Promise.resolve(1) }),
    } as unknown as Locator;
    const group = {
      count: () => Promise.resolve(1),
      all: () => Promise.resolve([control]),
    } as unknown as Locator;
    expect((await checkedReplyControls(group, 5)).valid).toBe(false);
    const after = await checkedReplyControls(group, 5, true);
    expect(after.valid).toBe(
      label === 'Hide replies' || label === 'Hide replies (5)',
    );
    expect(after.control).toBeUndefined();
    expect(after.diagnostic.controls[0]?.accepted).toBe(false);
  }
});
test.each([
  'Hide all replies',
  'Hide all 5 replies',
  'View more replies',
  'View 5 more replies',
  'See replies',
])(
  'ROWTEXT complete control %s stays inert and incomplete unknown controls stop',
  async (label) => {
    const control = {
      innerText: () => Promise.resolve(label),
      getAttribute: () => Promise.resolve('button'),
      locator: () => ({ count: () => Promise.resolve(1) }),
    } as unknown as Locator;
    const group = {
      count: () => Promise.resolve(1),
      all: () => Promise.resolve([control]),
    } as unknown as Locator;
    expect((await checkedReplyControls(group, 5, false, 5)).valid).toBe(false);
    expect(await checkedReplyControls(group, 5, true, 5)).toMatchObject({
      valid: true,
      control: undefined,
    });
    expect((await checkedReplyControls(group, null, true, 5)).valid).toBe(
      label.startsWith('Hide all'),
    );
    expect((await checkedReplyControls(group, 5, true, 4)).valid).toBe(
      label.startsWith('Hide all'),
    );
    expect(replyControlShape(label, 5).shape).toBe(
      label.startsWith('Hide all')
        ? 'hide-all-replies'
        : label.startsWith('View')
          ? 'view-more-replies'
          : 'other',
    );
  },
);
test('ROWTEXT complete row count never forgives a mismatching numbered expansion control', async () => {
  const control = {
    innerText: () => Promise.resolve('View all 4 replies'),
    getAttribute: () => Promise.resolve('button'),
    locator: () => ({ count: () => Promise.resolve(1) }),
  } as unknown as Locator;
  const group = {
    count: () => Promise.resolve(1),
    all: () => Promise.resolve([control]),
  } as unknown as Locator;
  expect((await checkedReplyControls(group, 5, true, 5)).valid).toBe(false);
});
