import { expect, test } from 'vitest';
import {
  normalize,
  fallback,
  HARMLESS_REASON,
  QUOTE_REASON,
  completeResults,
} from '../src/normalize.ts';
import { emptyUsage } from '../src/source.ts';
import type { CheckRequest } from '../src/source.ts';

const request: CheckRequest = {
  criteria: [
    {
      id: 'political',
      label: 'Political',
      definition: 'Generated definition.',
    },
  ],
  entries: [
    {
      id: 'e1',
      platform: 'x',
      kind: 'reply',
      text: 'Generated exact quotation for this entry.',
    },
  ],
};
const label = {
  category: 'political',
  risk: 2,
  quote: 'Generated exact',
  reason: 'Generated reason.',
};
const answer = (entries: unknown[]) => ({
  entries,
  answeredBy: 'generated',
  truncated: false,
  usage: emptyUsage(),
});
test('accepts exact quotes, maps by ID and fixes an empty list as harmless', () => {
  expect(
    normalize(request, answer([{ id: 'e1', labels: [label] }])).valid.get('e1'),
  ).toEqual([label]);
  expect(
    normalize(request, answer([{ id: 'e1', labels: [] }])).valid.get('e1')?.[0]
      ?.reason,
  ).toBe(HARMLESS_REASON);
});
test.each([
  [[], 'MISSING_ID'],
  [
    [
      { id: 'e1', labels: [] },
      { id: 'e1', labels: [] },
    ],
    'DUPLICATE_ID',
  ],
  [[{ id: 'e1', labels: [{ ...label, quote: null }] }], 'MISSING_QUOTE'],
  [
    [{ id: 'e1', labels: [{ ...label, quote: 'Generated wrong' }] }],
    'MISSING_QUOTE',
  ],
  [[{ id: 'e1', labels: [{ ...label, risk: 4 }] }], 'INVALID_LABEL'],
  [
    [{ id: 'e1', labels: [{ ...label, category: 'unknown' }] }],
    'INVALID_LABEL',
  ],
  [
    [
      {
        id: 'e1',
        labels: [{ ...label, reason: 'One sentence. Another sentence.' }],
      },
    ],
    'INVALID_LABEL',
  ],
  [[{ id: 'e1', labels: [label, label] }], 'INVALID_LABEL'],
] as const)('per-entry negative control %#', (entries, code) => {
  expect(normalize(request, answer([...entries])).invalid.get('e1')).toBe(code);
  const repaired = normalize(request, answer([{ id: 'e1', labels: [label] }]));
  expect(repaired.invalid.size).toBe(0);
});
test('short text must be quoted in full and unknown IDs do not poison a valid entry', () => {
  const short = {
    ...request,
    entries: [{ ...request.entries[0]!, text: 'short' }],
  };
  expect(
    normalize(
      short,
      answer([
        { id: 'e1', labels: [{ ...label, quote: 'short' }] },
        { id: 'foreign', labels: [] },
      ]),
    ).unknownIds,
  ).toBe(1);
  expect(fallback('MISSING_QUOTE')[0]?.reason).toBe(QUOTE_REASON);
});
test('truncation retains complete result objects but never an incomplete object', () => {
  const input =
    '{"results":[{"id":"e1","labels":[]},{"id":"e2","labels":[{"reason":"unfinished';
  expect(completeResults(input)).toEqual([{ id: 'e1', labels: [] }]);
  expect(completeResults('not JSON')).toEqual([]);
});
