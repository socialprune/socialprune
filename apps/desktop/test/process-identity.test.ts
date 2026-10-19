import { expect, test } from 'vitest';
import { matchingProcessIdentities } from './windows.ts';

test('a reused PID is not a browser remnant, but the same live identity is', () => {
  const browser = { pid: 123, born: '134369240577669435' };
  expect(matchingProcessIdentities([browser], [])).toEqual([]);
  expect(
    matchingProcessIdentities(
      [browser],
      [{ pid: browser.pid, born: '134369240577669436' }],
    ),
  ).toEqual([]);
  expect(matchingProcessIdentities([browser], [browser])).toEqual([browser]);
  expect(
    matchingProcessIdentities([browser], [{ ...browser, pid: 124 }]),
  ).toEqual([]);
});
