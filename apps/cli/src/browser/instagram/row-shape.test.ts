import { expect, test } from 'vitest';
import {
  rowShape,
  trailingLineAllowed,
  trailingLineFeatures,
} from './row-shape.ts';

test.each([
  [
    'generated_person\nInvented words\n2d\n3 likes',
    'extra-trailing-line',
    ['en-d'],
  ],
  ['generated_person\nInvented words\n2 Std.', 'age', ['de-h']],
  ['generated_person\nInvented words\n3mo', 'age', ['none']],
] as const)(
  'realshape row projection retains no values for %s',
  (text, failurePart, ageClasses) => {
    const result = rowShape(text, 'generated_person', false);
    expect(result).toMatchObject({
      lineCount: text.split('\n').length,
      handleLinePresent: true,
      ageClasses,
      failurePart,
    });
    expect(result.lineLengths).toHaveLength(text.split('\n').length);
    expect(JSON.stringify(result)).not.toContain('generated_person');
    expect(JSON.stringify(result)).not.toContain('Invented words');
  },
);
test.each([
  ['generated_person Invented words\n2d\nEdited', 'edited'],
  ['generated_person Invented words\n2d\nSee translation', 'see-translation'],
  ['generated_person Invented words\n2d\nPinned', 'pinned'],
  ['generated_person Invented words\n2d\nInvented label', 'other'],
  ['generated_person Invented words\n2d\nTranslated', 'translated'],
  ['generated_person Invented words\n2d\nReply', 'reply'],
  ['generated_person Invented words\n2d\nHidden', 'hidden'],
  ['generated_person Invented words\n2d\nLiked by creator', 'liked-by-creator'],
  ['generated_person Invented words\n2d\nAuthor', 'author'],
  ['generated_person Invented words\n2d\nCreator', 'creator'],
  ['generated_person Invented words\n2d\nEdited\nPinned', 'pinned'],
  ['generated_person Invented words\n3mo', 'none'],
] as const)(
  'ROW-TRAIL-1 refused row %# names only the closed class of its trailing line',
  (text, trailingClass) => {
    const refused = rowShape(text, 'generated_person', false);
    expect(refused.trailingClass).toBe(trailingClass);
    expect(JSON.stringify(refused)).not.toContain('Invented');
    expect(JSON.stringify(refused)).not.toContain('Edited');
    expect(rowShape(text, 'generated_person', true)).not.toHaveProperty(
      'trailingClass',
    );
  },
);
test('ROW-TRAIL-2 a structural trailing line is 1 to 30 characters and not an age, handle or counted label', () => {
  const handles = ['generated_person'];
  for (const line of [
    'Edited',
    'Invented flag',
    'x',
    'x'.repeat(30),
    'Ünïcode',
  ]) {
    expect(trailingLineAllowed(line, handles)).toBe(true);
  }
  for (const line of [
    'x'.repeat(31),
    '3d',
    '2 weeks',
    '3 Std.',
    'generated_person',
    'Generated_Person',
    '3 likes',
    '12 replies',
    '2 Gefällt mir-Angaben',
  ])
    expect(trailingLineAllowed(line, handles)).toBe(false);
  expect(trailingLineFeatures('Invent 2 ü label line x')).toEqual({
    letterOnly: false,
    words: 'threePlus',
    digits: true,
    nonAscii: true,
    lengthBucket: '21-30',
  });
  expect(trailingLineFeatures('See translation')).toEqual({
    letterOnly: true,
    words: 'two',
    digits: false,
    nonAscii: false,
    lengthBucket: '11-20',
  });
});
test('realshape distinguishes missing username and missing comment text without accepting either', () => {
  expect(
    rowShape('invalid handle\nwords\n2d', 'generated_person', false)
      .failurePart,
  ).toBe('age');
  expect(
    rowShape('invalid!\nwords\n2d', 'generated_person', false).failurePart,
  ).toBe('username');
  expect(
    rowShape('generated_person\n2d', 'generated_person', false).failurePart,
  ).toBe('text');
});
