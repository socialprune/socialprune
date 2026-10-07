import { expect, test } from 'vitest';
import { assertBuildIdentity, readBuildId } from './build-identity.ts';

test('an answering server with another build fails before acceptance logic', () => {
  const expected = '111111111111111111111111';
  const actual = '222222222222222222222222';
  expect(() =>
    assertBuildIdentity(expected, actual, 'http://127.0.0.1:4180'),
  ).toThrow('E2E build mismatch');
  expect(() =>
    assertBuildIdentity(expected, expected, 'http://127.0.0.1:4180'),
  ).not.toThrow();
  expect(readBuildId(`export const buildId="${expected}";`)).toBe(expected);
  expect(() => readBuildId('invented missing metadata')).toThrow(
    'missing or ambiguous',
  );
});
