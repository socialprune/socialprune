import { expect, test } from 'vitest';
import { replyControlShape } from './reply-controls.ts';
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
