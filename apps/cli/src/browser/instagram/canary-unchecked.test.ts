import { expect, test } from 'vitest';
import { canaryUnchecked } from './canary.ts';
import type { CanaryCheck, FieldCheck } from './canary.ts';

const field = (found: boolean, agrees = found): FieldCheck => ({
  found,
  agrees,
  paths: [],
  equalPaths: [],
});
const check = (
  fields: Partial<
    Record<'owner' | 'time' | 'caption' | 'image', FieldCheck>
  > = {},
  extra: Partial<CanaryCheck> = {},
): CanaryCheck => ({
  confirmed: true,
  fields: {
    owner: field(true),
    time: field(true),
    caption: field(true),
    image: field(true),
    ...fields,
  },
  ownerShown: true,
  timeShown: true,
  imageStored: true,
  screenshotStored: true,
  ...extra,
});

test('CHECK-SKIP-1 several objects that all agree on every field stay checked, as under IG-IMAGE A', () => {
  expect(canaryUnchecked(check(), 2)).toBeNull();
});
test('CHECK-SKIP-1 several qualifying objects with a disagreement or a missing field make a step unchecked', () => {
  expect(canaryUnchecked(check({ owner: field(true, false) }), 2)).toEqual({
    reason: 'several-objects',
    fields: [],
  });
  expect(canaryUnchecked(check({ time: field(false) }), 2)).toEqual({
    reason: 'several-objects',
    fields: ['time'],
  });
});
test('CHECK-SKIP-1 one object with a missing field is unchecked, with the fields named', () => {
  expect(canaryUnchecked(check({ time: field(false) }), 1)).toEqual({
    reason: 'field-not-found',
    fields: ['time'],
  });
  expect(
    canaryUnchecked(check({ image: field(false) }, { imageStored: false }), 1),
  ).toEqual({ reason: 'field-not-found', fields: ['image'] });
});
test('CHECK-SKIP-1 a found disagreement or a page-side gap on one object is never unchecked', () => {
  expect(canaryUnchecked(check({ owner: field(true, false) }), 1)).toBeNull();
  expect(
    canaryUnchecked(
      check({ owner: field(true, false), time: field(false) }),
      1,
    ),
  ).toBeNull();
  expect(
    canaryUnchecked(check({ time: field(false) }, { timeShown: false }), 1),
  ).toBeNull();
  expect(canaryUnchecked(check({}, { imageStored: false }), 1)).toBeNull();
  expect(canaryUnchecked(check(), 1)).toBeNull();
});
test('CHECK-SKIP-1 an IMAGE-4 not-applicable image is not "not found"', () => {
  const na = check(
    { image: { ...field(false), notApplicable: 'video-without-image' } },
    { imageStored: false },
  );
  expect(canaryUnchecked(na, 1)).toBeNull();
  expect(
    canaryUnchecked({ ...na, fields: { ...na.fields, time: field(false) } }, 1),
  ).toEqual({ reason: 'field-not-found', fields: ['time'] });
});
