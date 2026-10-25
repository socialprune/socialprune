import { expect, test } from 'vitest';
import { pageRecycleDue, PAGE_RECYCLE_INTERVAL } from './recycle.ts';
test('C35 IG19 interval20 applies only after completed main steps and a settled attempt', () => {
  expect(PAGE_RECYCLE_INTERVAL).toBe(20);
  expect(pageRecycleDue(19, 0, false, false)).toBe(false);
  expect(pageRecycleDue(20, 0, false, false)).toBe(true);
  expect(pageRecycleDue(39, 20, false, false)).toBe(false);
  expect(pageRecycleDue(40, 20, false, false)).toBe(true);
  expect(pageRecycleDue(20, 0, true, false)).toBe(false);
  expect(pageRecycleDue(20, 0, false, true)).toBe(false);
});
