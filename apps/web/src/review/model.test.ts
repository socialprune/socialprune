import { expect, test } from 'vitest';
import {
  evidenceParts,
  evidenceSegments,
  letterDecision,
  platformLink,
} from './model.ts';

test('single-letter decisions require enabled grid focus', () => {
  expect(letterDecision('m', true, true)).toBe('delete');
  expect(letterDecision('k', false, true)).toBeNull();
  expect(letterDecision('l', true, false)).toBeNull();
  expect(letterDecision('j', true, true)).toBeNull();
});
test('full-text evidence joins overlaps and never highlights a non-verbatim quote', () => {
  expect(
    evidenceSegments('Invented café note.', [
      'café',
      'café note',
      'CAFE',
      null,
    ]),
  ).toEqual([
    { text: 'Invented ', highlight: false },
    { text: 'café note', highlight: true },
    { text: '.', highlight: false },
  ]);
  expect(evidenceSegments('<script>literal</script>', ['<script>'])).toEqual([
    { text: '<script>', highlight: true },
    { text: 'literal</script>', highlight: false },
  ]);
});
test('platform links reject executable and unrelated URLs', () => {
  expect(
    platformLink(['javascript', 'globalThis.__pwned=1'].join(':')),
  ).toBeNull();
  expect(platformLink('https://example.invalid/invented')).toBeNull();
  expect(platformLink('https://x.com/invented/status/1')).toBe(
    'https://x.com/invented/status/1',
  );
});
test('only verbatim evidence produces a text-node highlight', () => {
  expect(evidenceParts('Invented <script>word</script>', '<script>')).toEqual({
    before: 'Invented ',
    match: '<script>',
    after: 'word</script>',
  });
  expect(evidenceParts('Invented café', 'CAFE')).toBeNull();
  expect(evidenceParts('Invented text', '')).toBeNull();
});
