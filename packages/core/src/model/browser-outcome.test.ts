import { expect, test } from 'vitest';
import { OutcomeEventSchema, DecisionEventSchema } from './index.ts';
import { OutcomeSchema } from './v1.ts';
const action = {
  id: 'generated-attempt',
  kind: 'single',
  size: 1,
  reverts: null,
};
const event = {
  eventId: 'generated-event',
  seq: 1,
  itemId: 'x:1001',
  value: 'deleted-via-browser',
  previous: 'unknown',
  recordedAt: '2026-10-11T00:00:00.000Z',
  source: { kind: 'human', via: 'browser-x' },
  action,
};
test('browser deletion outcome and its amended via are accepted', () => {
  expect(
    OutcomeSchema.parse({
      itemId: event.itemId,
      value: event.value,
      recordedAt: event.recordedAt,
    }).value,
  ).toBe('deleted-via-browser');
  expect(OutcomeEventSchema.parse(event)).toEqual(event);
  expect(
    OutcomeEventSchema.safeParse({
      ...event,
      source: { kind: 'agent', via: 'browser-x' },
    }).success,
  ).toBe(false);
});
test('browser via never authorizes a decision event', () => {
  expect(
    DecisionEventSchema.safeParse({
      ...event,
      value: 'delete',
      previous: 'undecided',
      decidedAt: event.recordedAt,
    }).success,
  ).toBe(false);
});
