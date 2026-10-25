import { expect, test } from 'vitest';
import { listImageOnlyManual } from './list-image-only.ts';
import type { ListTimeoutDiagnostic } from './report.ts';
import { ContextStepReportSchema } from './report.ts';

const observed = (): ListTimeoutDiagnostic => ({
  rowContainers: 4,
  readableRows: 1,
  imageOnlyRows: 3,
  statusElementPresent: false,
  busyElementPresent: false,
  emptyStateClassKnown: false,
  emptyStatePresent: false,
  rowsObserved: true,
  filter: {
    applied: true,
    readbackObserved: true,
    startMatches: true,
    endMatches: true,
  },
  dom: {
    observed: true,
    changes: 4,
    lastChangeAfterApplyMs: 917,
    observedForMs: 30200,
  },
  observationFailed: false,
});

test('C34 IG-18 manual report requires zero candidates, no confirmation/image and strict complete evidence', () => {
  const step = {
    result: 'list-image-only',
    confirmed: false,
    candidates: 0,
    image: {
      status: 'not-attempted',
      bytes: 0,
      qualifyingObjects: 0,
      matchingLists: 0,
      distinctListLengths: [],
      source: 'none',
    },
    listTimeout: observed(),
  };
  expect(ContextStepReportSchema.safeParse(step).success).toBe(true);
  for (const change of [
    { confirmed: true },
    { candidates: 1 },
    { listTimeout: undefined },
    {
      listTimeout: {
        ...observed(),
        filter: { ...observed().filter, startMatches: false },
      },
    },
  ])
    expect(
      ContextStepReportSchema.safeParse({ ...step, ...change }).success,
    ).toBe(false);
});
test('C34 IG-18 only complete settled matched-filter observations can stay manual', () => {
  expect(listImageOnlyManual(observed())).toBe(true);
  expect(
    listImageOnlyManual({
      ...observed(),
      dom: { ...observed().dom, lastChangeAfterApplyMs: 29700 },
    }),
  ).toBe(true);
  expect(
    listImageOnlyManual({
      ...observed(),
      dom: { ...observed().dom, lastChangeAfterApplyMs: 29701 },
    }),
  ).toBe(false);
  for (const change of [
    { imageOnlyRows: 0 },
    { rowsObserved: false },
    { observationFailed: true },
    { statusElementPresent: true },
    { busyElementPresent: true },
    { filter: { ...observed().filter, applied: false } },
    { filter: { ...observed().filter, readbackObserved: false } },
    { filter: { ...observed().filter, startMatches: false } },
    { filter: { ...observed().filter, endMatches: false } },
    { dom: { ...observed().dom, observed: false } },
    { dom: { ...observed().dom, lastChangeAfterApplyMs: null } },
    { dom: { ...observed().dom, lastChangeAfterApplyMs: 30000 } },
  ])
    expect(listImageOnlyManual({ ...observed(), ...change })).toBe(false);
});
