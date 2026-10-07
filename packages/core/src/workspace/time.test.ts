import { expect, test } from 'vitest';
import { dayKey, resolveTimeZone } from './time.ts';
const cases = [
  ['2026-10-06T23:30:00Z', 'Europe/Berlin', '2026-10-07'],
  ['2026-10-06T23:30:00Z', 'America/Los_Angeles', '2026-10-06'],
  ['2026-03-29T00:30:00Z', 'Europe/Berlin', '2026-03-29'],
  ['2026-03-29T01:30:00Z', 'Europe/Berlin', '2026-03-29'],
  ['2026-10-25T00:30:00Z', 'Europe/Berlin', '2026-10-25'],
  ['2026-10-25T01:30:00Z', 'Europe/Berlin', '2026-10-25'],
  ['2026-01-01T02:00:00Z', 'America/Los_Angeles', '2025-12-31'],
  ['2026-01-01T02:00:00Z', 'UTC', '2026-01-01'],
  ['2026-06-01T20:00:00Z', 'Asia/Tokyo', '2026-06-02'],
  ['2026-01-01T00:00:00Z', 'Pacific/Honolulu', '2025-12-31'],
] as const;
test.each(cases)(
  'hand-written day table: %s in %s => %s',
  (utc, zone, expected) => {
    expect(dayKey(utc, zone)).toBe(expected);
  },
);
test('time zone precedence never mutates stored settings and invalid input is rejected', () => {
  expect(resolveTimeZone('Asia/Tokyo', 'Europe/Berlin', 'UTC')).toEqual({
    timeZone: 'Asia/Tokyo',
    source: 'flag',
  });
  expect(resolveTimeZone(null, 'Europe/Berlin', 'UTC')).toEqual({
    timeZone: 'Europe/Berlin',
    source: 'workspace',
  });
  expect(resolveTimeZone(undefined, null, 'UTC')).toEqual({
    timeZone: 'UTC',
    source: 'system',
  });
  expect(() => dayKey('bad-instant', 'UTC')).toThrow('INVALID_QUERY');
  expect(() => resolveTimeZone('Invented/Zone', 'UTC')).toThrow(
    'INVALID_QUERY',
  );
});
