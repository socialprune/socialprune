import { expect, test } from 'vitest';
import { OutcomePace, estimateMinutes } from './pace.ts';

test('measured pace begins only after twenty acknowledged records', () => {
  const pace = new OutcomePace();
  pace.begin(1000);
  for (let index = 1; index < 20; index++) pace.record(1000 + index * 9000);
  expect(pace.seconds()).toBeNull();
  pace.record(181000);
  expect(pace.seconds()).toBe(9);
  expect(estimateMinutes(180, 9)).toBe(27);
  expect(estimateMinutes(600, 10)).toBe(100);
});
