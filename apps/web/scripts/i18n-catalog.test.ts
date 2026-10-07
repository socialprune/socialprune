import { expect, test } from 'vitest';
import { argumentsOf, validateCatalogs } from './i18n-catalog.ts';

test('extracts argument types and rejects mismatches, missing keys and missing plural branches', () => {
  expect(
    argumentsOf('{count, plural, one {Entry} other {Entries}} {name}'),
  ).toEqual({ count: 'number', name: 'string' });
  expect(() =>
    validateCatalogs({ name: '{count, number}' }, { name: '{count}' }),
  ).toThrow('arguments differ');
  expect(() => validateCatalogs({ name: 'Name' }, {})).toThrow('keys differ');
  expect(() => argumentsOf('{count, plural, other {Entries}}')).toThrow(
    'branches',
  );
  expect(() =>
    validateCatalogs({ sample: 'guaranteed' }, { sample: 'Beispiel' }),
  ).toThrow('Forbidden copy');
});
