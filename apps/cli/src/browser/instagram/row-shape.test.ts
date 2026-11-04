import { expect, test } from 'vitest';
import { rowShape } from './row-shape.ts';

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
