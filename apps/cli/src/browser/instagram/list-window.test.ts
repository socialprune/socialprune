import { expect, test } from 'vitest';
import { windowFacts } from './list-window.ts';

test.each(['Europe/Berlin', 'Pacific/Kiritimati', 'Etc/GMT+12'])(
  'IG-list window facts in %s contain the exported day across year and offset boundaries',
  (zone) => {
    const result = windowFacts('2025-01-01T00:30:00Z', zone);
    expect(result).toEqual({
      observed: true,
      observationFailed: false,
      windowLengthDays: 3,
      exportInsideWorkspaceWindow: true,
      exportInsideUtcWindow: true,
      startEndSameDay: false,
      startYearOffset: -1,
      endYearOffset: 0,
    });
    for (const value of ['2024', '2025', zone, '01-01'])
      expect(JSON.stringify(result)).not.toContain(value);
  },
);

test('IG-list wrong window and malformed zone remain diagnostic facts, never a change to the planned filter', () => {
  expect(
    windowFacts('2025-01-01T00:30:00Z', 'Europe/Berlin', [
      '2025-02-01',
      '2025-02-01',
    ]),
  ).toMatchObject({
    observed: true,
    windowLengthDays: 1,
    exportInsideWorkspaceWindow: false,
    exportInsideUtcWindow: false,
    startEndSameDay: true,
  });
  expect(windowFacts('2025-01-01T00:30:00Z', 'not/a/zone')).toMatchObject({
    observed: false,
    observationFailed: true,
    windowLengthDays: null,
  });
});
