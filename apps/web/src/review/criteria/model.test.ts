import { expect, test } from 'vitest';
import { defaultCriteria } from '@socialprune/core/criteria';
import {
  contentLimitOffer,
  ruleModels,
  storedRules,
  toggleCriterion,
} from './model.ts';

test('32 selections keep their IDs and a 33rd is rejected until one is unticked', () => {
  const criteria = {
    ...defaultCriteria(),
    selected: Array.from({ length: 32 }, (_, n) => `earlier-${n}`),
  };
  expect(toggleCriterion(criteria, 'new', true)).toBeNull();
  const unselected = toggleCriterion(criteria, 'earlier-0', false)!;
  expect(toggleCriterion(unselected, 'new', true)?.selected).toHaveLength(32);
  expect(criteria.selected).toHaveLength(32);
});
test('content-limit offers distinguish dates, likes and reposts from content criteria', () => {
  expect(contentLimitOffer('At least 10 likes')).toEqual({
    kind: 'likes',
    value: '10',
  });
  expect(contentLimitOffer('Mehr als 8 Reposts')).toEqual({
    kind: 'reposts',
    value: '8',
  });
  expect(contentLimitOffer('1.5 likes')).toEqual({
    kind: 'likes',
    value: '1.5',
  });
  expect(contentLimitOffer('-10 likes')).toEqual({
    kind: 'likes',
    value: '-10',
  });
  expect(contentLimitOffer('Ab 2024-02-01')).toEqual({
    kind: 'date',
    value: '2024-02-01',
  });
  expect(contentLimitOffer('Mentions an invented violet toolbox')).toBeNull();
});
test('rule model round-trip preserves OR fields, toggles and unknown inclusion; invalid values stay out', () => {
  const stored = [
    { id: 'popular', kind: 'top-liked-tenth', enabled: false },
    {
      id: 'likes',
      kind: 'likes-at-least',
      enabled: true,
      count: 8,
      alsoWhenUnknown: true,
    },
    { id: 'date', kind: 'created-from', enabled: true, date: '2024-02-01' },
  ] as const;
  const models = ruleModels(stored, { likes: 3 }, 12);
  expect(models[0]?.value).toBe('12');
  expect(models[1]?.held).toBe(3);
  expect(storedRules(models)).toEqual(stored);
  expect(storedRules([{ ...models[1]!, value: '1.5' }])).toBeNull();
  expect(storedRules([{ ...models[2]!, value: '2024-02-31' }])).toBeNull();
});
