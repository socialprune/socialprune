import { expect, test } from 'vitest';
import { combineRunMemory, PageRecyclingSchema } from './report.ts';
test('C35 recycled page observers preserve total samples and field-wise run peaks', () => {
  const first = {
    samples: 20,
    failedSamples: 1,
    sessionAttached: true,
    observationFailed: true,
    peak: {
      jsHeapUsedMB: 90,
      jsHeapTotalMB: 120,
      nodes: 300,
      documents: 4,
      jsEventListeners: 50,
      frames: 4,
    },
  };
  const second = {
    samples: 1,
    failedSamples: 0,
    sessionAttached: true,
    observationFailed: false,
    peak: {
      jsHeapUsedMB: 20,
      jsHeapTotalMB: 30,
      nodes: 400,
      documents: 1,
      jsEventListeners: 20,
      frames: 1,
    },
  };
  expect(combineRunMemory([first, second])).toEqual({
    ...first,
    samples: 21,
    peak: { ...first.peak, nodes: 400 },
  });
});
test('C35 recycling report only admits complete ordered twenty-step between-step events', () => {
  const event = {
    afterStep: 20,
    nextStep: 21,
    reason: 'step-interval',
    checks: 'next-list',
  };
  expect(
    PageRecyclingSchema.safeParse({
      intervalSteps: 20,
      count: 1,
      events: [event],
    }).success,
  ).toBe(true);
  for (const value of [
    { intervalSteps: 10, count: 1, events: [event] },
    { intervalSteps: 20, count: 0, events: [event] },
    { intervalSteps: 20, count: 1, events: [{ ...event, nextStep: 20 }] },
    { intervalSteps: 20, count: 2, events: [event, event] },
  ])
    expect(PageRecyclingSchema.safeParse(value).success).toBe(false);
});
